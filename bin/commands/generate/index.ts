import { Command } from 'commander'

import client from './client'
import spec from './spec'
import code from './code'
import model from './model'
import cli from './cli/index'

export default (cmd: Command) => {
  cmd.description('generate util')
  spec(cmd.command('spec'))
  client(cmd.command('client'))
  code(cmd.command('code'))
  model(cmd.command('model'))
  cli(cmd.command('cli'))
}
