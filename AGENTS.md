# General guidelines

- The extension uses only TypeScript.
- Do not add new dependencies without prior approval or direct instruction.

# Code guidelines

- All code should have proper typing. Using any or unknown, even implicitly, is highly discouraged.
- New features must always be accompanied by tests.
- Before you finish your work, always make sure the code compiles and all tests pass.
- When building new features, start with a simple solution, even if it doesn't satisfy the entire request, and add
  complexity incrementally until you reach your goal.

# Test guidelines

- All test code must be located in the `tests` folder. Test files are named `*.test.ts`.
- Structure tests by feature.
- Use `it()` from `vitest` instead of `test()`.
- Tests that call the real REST endpoint are prohibited.
