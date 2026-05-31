# General guidelines

- The extension uses only TypeScript.
- Do not add new dependencies without prior approval or direct instruction.
- Work incrementally. Start with a small slice of a feature or a very basic test and only add more after you were able
  to verify that it works.

# Code guidelines

- All code should have proper typing. Using any or unknown, even implicitly, is highly discouraged.
- New features must always be accompanied by tests.
- Before you finish your work, always make sure the code compiles, all tests pass, and eslint reports no errors.

# Test guidelines

- All test code must be located in the `tests` folder. Test files are named `*.test.ts`.
- Structure tests by feature.
- Use `it()` from `vitest` instead of `test()`.
- Tests that call the real REST endpoint are prohibited. Use nock for mocking HTTP requests.
