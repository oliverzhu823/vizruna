# Third-party notices

Vizruna is a public Alpha under active development. Its source is visible for
transparency and collaboration. Unless a separate license is published,
Vizruna-specific source code and binaries are not licensed for redistribution.

## justhil/pi-app

- Source: <https://github.com/justhil/pi-app>
- Pinned baseline: `bcef920e3900a858b305c67c42a34e61779f977c`
- License: MIT.
- The pinned baseline declares MIT in `package.json`. Upstream later added the
  repository-level MIT license in commit
  [`0ae02be2e5e09586aa89c35358f1aab952705e6c`](https://github.com/justhil/pi-app/commit/0ae02be2e5e09586aa89c35358f1aab952705e6c).
- The upstream author also confirmed the clarification in
  [Issue #38](https://github.com/justhil/pi-app/issues/38).

The MIT license permits commercial use, modification, distribution,
sublicensing and sale, subject to retaining its copyright and permission
notice. Vizruna packages a verbatim copy at
`THIRD_PARTY_LICENSES/justhil-pi-app-MIT.txt`.

## minghinmatthewlam/pi-gui

- Source: <https://github.com/minghinmatthewlam/pi-gui>
- Research baseline: `48ed3025868ddb9fd359cd1fc19b7ac48916cb39`
- License: MIT; the upstream repository contains a `LICENSE` file.

The target architecture reimplements selected business behavior. Any source code
copied in the future must retain the applicable MIT copyright and license notice
and must be recorded in this file.

## Pi coding agent

- Package: `@earendil-works/pi-coding-agent`
- Pinned version: `0.82.1`
- Declared license: MIT.

The generated software bill of materials is maintained separately and does not
replace this source-level notice.

## Production dependency inventory

[`THIRD_PARTY_DEPENDENCIES.md`](./THIRD_PARTY_DEPENDENCIES.md) is generated from
the installed production dependency tree together with the CycloneDX SBOM. It
records package, version and declared license for every production component.
This inventory supports dependency review but does not replace each applicable
license notice or a release-specific compliance review.
