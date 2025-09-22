import { Command } from 'commander'

import client from './client'
import spec from './spec'
import code from './code'
import model from './model'

export default (cmd: Command) => {
  cmd.description('generate util')
  spec(cmd.command('spec'))
  client(cmd.command('client'))
  code(cmd.command('code'))
  model(cmd.command('model'))
}
