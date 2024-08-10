#!/usr/bin/env bun

import { program } from 'commander'

import { pckg } from './util'

import dev from './commands/dev'
import build from './commands/build'
import generate from './commands/generate'
import info from './commands/info'

program.name('galbe').description(pckg.description).version(pckg.version)

dev(program.command('dev'))
build(program.command('build'))
generate(program.command('generate'))
info(program.command('info'))

program.parse()
