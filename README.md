<p align="center">
  <a href="https://galbe.dev"><img src="https://galbe.dev/galbe.svg" alt="Logo" height=150></a>
</p>
<h1 align="center">Galbe</h1>

[![Build & Test](https://github.com/pierre-cm/galbe/actions/workflows/build_test.yml/badge.svg?branch=main)](https://github.com/pierre-cm/galbe/actions/workflows/build_test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/pierre-cm/galbe/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/galbe)](https://www.npmjs.com/package/galbe)

Galbe is a fast, lightweight and highly customizable JavaScript web framework based on [Bun](https://bun.sh).

> [!IMPORTANT]  
> Galbe is currently under active development and not guaranteed to be stable. Future releases may potentially introduce breaking changes.

## Features

- **Fast**: Built on top of Bun, Galbe is designed for speed.
- **Lightweight**: Minimal core with a plugin system to add only what you need.
- **Type-safe**: Built with TypeScript for a great developer experience, with runtime validation using Galbe Schemas.
- **Plugins**: Extensible architecture to easily add functionality.

## Philosophy

Galbe aims to provide a developer-friendly experience without compromising on performance. It embraces the "use the platform" mentality, leveraging modern web standards and the capabilities of the Bun runtime.

## Getting started

Create a new Galbe app:

```bash
bun create galbe app
cd app
bun install && bun dev
```

The Galbe CLI ships with the package. You can invoke it with `bunx galbe` or
install it globally using `bun install -g galbe`.

## Documentation

The detailed documentation is available at [galbe.dev](https://galbe.dev).

## Community

- [GitHub Discussions](https://github.com/pierre-cm/galbe/discussions)

## Contributing

Please refer to the [Contributing Guide](https://github.com/pierre-cm/galbe/blob/main/docs/community/CONTRIBUTING.md) to start contributing to Galbe.
