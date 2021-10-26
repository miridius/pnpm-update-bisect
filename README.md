# pnpm-update-bisect

An implementation of the [npm-check-updates](https://github.com/raineorshine/npm-check-updates) "doctor" mode made for [pnpm](https://pnpm.io/), using [bisection](https://git-scm.com/docs/git-bisect) to find failing packages faster.

## About

`pub` is a small CLI tool which updates all packages to their latest versions (ignoring specified version ranges), runs your tests, and in case of failure finds and rolls back the updates that caused failed tests.

Afterwards it does a second pass to try to update the failed packages again but this time within the compatible version range.

## Usage

With installation:

```bash
pnpm i -D pnpm-update-bisect
pnpm pub # or pnpm pnpm-update-bisect
```

Without installation:

```bash
pnpm dlx pnpm-update-bisect
```

## Warning

At the moment this is just a prototype that I created for use in my own projects. It has not yet been extensively tested.
