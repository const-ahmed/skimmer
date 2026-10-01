# Third-party notices

## GitDiagram

This project contains a small amount of code adapted from
[GitDiagram](https://github.com/ahmedkhaleel2004/gitdiagram) in the files listed
below. Those portions are covered by GitDiagram's MIT licence.

| Skimmer | GitDiagram source |
|---|---|
| `src/shared/github-url.ts` | `src/features/diagram/github-url.ts` |
| `src/server/repository/paths.ts` | path filters in `src/server/generate/github.ts` and `repository-context.ts` |
| `src/server/repository/ranking.ts` | `score` and `rankSourcePaths` in `src/server/generate/repository-context.ts` |
| `src/server/repository/references.ts` | `src/server/generate/source-references.ts` |
| `src/server/repository/excerpt.ts` | `src/server/generate/source-excerpt.ts` |
| `src/server/architecture/retrieval.ts` | two-round reading, excerpt choice, core modules and SOURCE INDEX in `src/server/generate/source-context.ts` |
| `src/server/github/snapshot.ts` | truncated-tree handling in `src/server/generate/github.ts` |

GitDiagram is distributed under the following licence:

```
MIT License

Copyright (c) 2024 Ahmed Khaleel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
