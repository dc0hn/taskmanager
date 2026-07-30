import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `src-tauri/target` is Rust build output. Among it are Tauri's codegen assets, which
  // are compressed binaries written with a `.js` extension — eslint was reading them as
  // source and reporting eleven parse errors on bytes no human wrote. Nothing under
  // either directory is source, so neither should ever be linted.
  globalIgnores(['dist', 'src-tauri/target']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // `react-hooks/set-state-in-effect`, switched off for six files and nowhere else.
    //
    // This is an exception, not a disagreement: the rule is correct that setState in an
    // effect risks cascading renders, and it stays on everywhere else so new code is held
    // to it. What it cannot distinguish is the two shapes below, both of which are the
    // point of the code rather than an oversight.
    //
    //   RECONCILIATION (App.tsx, nine sites). XP, day stats, streaks, badges, the codex
    //   and quest payouts are derived from blocks and then PERSISTED. Deriving during
    //   render — the rule's usual answer — cannot work for a figure that has to survive a
    //   reload, and the derivation is what decides whether an award has been paid. Each
    //   pass is idempotent by construction, which is what keeps the cascade finite: a
    //   day's XP is recomputed and only the delta applied, so re-running settles rather
    //   than compounds. There are tests asserting exactly that.
    //
    //   HAND-STEPPED ANIMATION (PixelMeter, ProgressWheel). Lighting meter cells one at a
    //   time IS a sequence of state changes on a timer. Framer would remove the need, and
    //   if these ever move onto motion values the exception should shrink to match.
    //
    //   FORM RESET ON OPEN (BackupModal, DayMarkImport, EditBlockModal). The genuinely
    //   fixable ones: a `key` on each modal would remount it and drop the effects
    //   entirely. Left as-is because it changes three call sites for no behavioural gain,
    //   and it is the honest first thing to do if this list is ever revisited.
    files: [
      'src/App.tsx',
      'src/components/BackupModal.tsx',
      'src/components/DayMarkImport.tsx',
      'src/components/EditBlockModal.tsx',
      'src/components/ProgressWheel.tsx',
      'src/components/pixel/PixelMeter.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
