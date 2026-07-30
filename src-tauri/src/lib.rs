use std::io::Write;
use tauri::Manager;

/// Write a snapshot of the whole profile to a fixed path in the app data directory.
///
/// The narrowest useful shape for this, deliberately. The frontend hands over CONTENTS
/// and nothing else — it cannot name a path, so there is no argument here that could be
/// pointed somewhere it should not go, and no need for a broad filesystem grant to cover
/// the one file the app actually writes.
///
/// Durability comes from fsync-then-rename, in that order, and the order is the point.
/// `rename` alone buys atomic VISIBILITY — a reader sees the old file or the new one,
/// never half of either — but not durability against power loss: the rename can be
/// journalled while the temp file's data blocks are still sitting in the page cache,
/// which after a hard crash leaves a snapshot that is present, correctly named, and
/// empty. Syncing the file before the rename, and the directory after it, is what makes
/// the file's contents and its name both survive.
///
/// One generation is kept behind the current file, because the failure that matters is
/// not a torn write but a snapshot taken of state that had already gone wrong — and
/// overwriting the last good copy with it is exactly the loss a snapshot exists to
/// prevent.
#[tauri::command]
fn write_snapshot(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    // A profile is JSON of plans and counters. Tens of megabytes means something has
    // gone wrong upstream, and refusing is better than filling a disk.
    const MAX_BYTES: usize = 64 * 1024 * 1024;
    if contents.len() > MAX_BYTES {
        return Err(format!(
            "snapshot is {} bytes, over the {} byte limit",
            contents.len(),
            MAX_BYTES
        ));
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;

    write_rotating(&dir, &contents).map(|p| p.to_string_lossy().into_owned())
}

/// The write itself, separated from the command so it can be tested without a Tauri
/// process. Takes the directory rather than resolving one, which is the only reason a
/// test can point it at a temporary path.
fn write_rotating(dir: &std::path::Path, contents: &str) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let current = dir.join("almanac-snapshot.json");
    let previous = dir.join("almanac-snapshot.prev.json");
    let temp = dir.join("almanac-snapshot.json.tmp");

    {
        let mut f =
            std::fs::File::create(&temp).map_err(|e| format!("write failed: {e}"))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| format!("write failed: {e}"))?;
        // The data is on the platter before the name points at it. Without this the
        // rename can land first and the contents never arrive.
        f.sync_all().map_err(|e| format!("sync failed: {e}"))?;
    }

    if current.exists() {
        // Best effort: losing the previous generation is not a reason to throw away a
        // good new snapshot.
        let _ = std::fs::rename(&current, &previous);
    }
    std::fs::rename(&temp, &current).map_err(|e| format!("rename failed: {e}"))?;

    // And the rename itself. Directory metadata is cached like anything else, so without
    // this the file can be durable under a name that did not survive. Best effort: some
    // filesystems refuse to sync a directory handle, and failing the whole snapshot over
    // that would be worse than the weaker guarantee.
    if let Ok(d) = std::fs::File::open(dir) {
        let _ = d.sync_all();
    }

    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::write_rotating;

    /// A scratch directory under the OS temp dir, removed on drop.
    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("almanac-test-{name}"));
            let _ = std::fs::remove_dir_all(&dir);
            Scratch(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn writes_a_snapshot_and_creates_the_directory() {
        let s = Scratch::new("writes");
        let path = write_rotating(&s.0, "{\"a\":1}").expect("write");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn keeps_one_generation_behind() {
        // The failure this guards against is not a torn write but a snapshot taken of
        // state that had already gone wrong. Overwriting the last good copy with it is
        // the loss the snapshot exists to prevent.
        let s = Scratch::new("rotates");
        write_rotating(&s.0, "first").expect("first");
        write_rotating(&s.0, "second").expect("second");

        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.json")).unwrap(),
            "second"
        );
        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.prev.json")).unwrap(),
            "first"
        );
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        // A stray .tmp would be mistaken for a snapshot by anyone looking in the folder.
        let s = Scratch::new("no-temp");
        write_rotating(&s.0, "x").expect("write");
        assert!(!s.0.join("almanac-snapshot.json.tmp").exists());
    }

    #[test]
    fn the_written_file_reads_back_byte_for_byte() {
        // The snapshot was write-only, so nothing had ever asserted it round-trips. A
        // backup you cannot read is a backup in name.
        let s = Scratch::new("roundtrip");
        let json = r#"{"format":"almanac.export","records":{"dp:plan:2026-07-30":{}}}"#;
        let path = write_rotating(&s.0, json).expect("write");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), json);
    }

    #[test]
    fn both_generations_are_readable_after_two_writes() {
        // The reason to keep a generation is to restore from it, which means it has to be
        // readable and it has to be the older one.
        let s = Scratch::new("generations");
        write_rotating(&s.0, "older").expect("first");
        write_rotating(&s.0, "newer").expect("second");
        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.json")).unwrap(),
            "newer"
        );
        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.prev.json")).unwrap(),
            "older"
        );
    }

    #[test]
    fn overwrites_rather_than_appending() {
        let s = Scratch::new("truncates");
        write_rotating(&s.0, "a-long-first-snapshot").expect("first");
        write_rotating(&s.0, "short").expect("second");
        assert_eq!(
            std::fs::read_to_string(s.0.join("almanac-snapshot.json")).unwrap(),
            "short"
        );
    }
}


/// Read the snapshot back, so the second copy is usable from inside the app.
///
/// The snapshot was write-only, which made it a backup in name. Restoring meant quitting,
/// finding the file in Finder, opening it in an editor, copying the whole thing and
/// pasting it into the import box — at exactly the moment someone is least equipped to go
/// path-hunting. `importAll` already takes JSON text and already validates every record,
/// so this is the only piece that was missing.
///
/// `previous` selects the generation kept behind the current file, which is what you want
/// when the current one turns out to be a snapshot of already-broken state.
///
/// Same shape as the writer: no path argument. The frontend asks for "the snapshot" or
/// "the one before it" and gets text back.
#[tauri::command]
fn read_snapshot(app: tauri::AppHandle, previous: bool) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    let name = if previous {
        "almanac-snapshot.prev.json"
    } else {
        "almanac-snapshot.json"
    };
    let path = dir.join(name);
    if !path.exists() {
        return Err(format!("no snapshot at {}", path.display()));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("could not read {}: {e}", path.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![write_snapshot, read_snapshot])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
