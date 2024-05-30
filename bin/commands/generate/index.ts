import { Command } from 'commander'

import client from './client'
import spec from './spec'
import code from './code'

export default (cmd: Command) => {
  cmd.description('generate util')
  client(cmd.command('client'))
  spec(cmd.command('spec'))
  code(cmd.command('code'))
}
