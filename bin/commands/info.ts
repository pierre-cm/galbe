import os from 'os'
import { Command } from 'commander'

export default async (cmd: Command) => {
  cmd.description('print informations about the current os, bun and galbe version').action(async () => {
    const osName = os.type()
    const osArch = os.arch()
    const osVersion = os.release()

    const bunVersion = Bun.version
    const bunRevision = Bun.revision

    let localPckg: any = {}
    try {
      localPckg = await Bun.file('./node_modules/galbe/package.json').json()
    } catch (err) {}
    const galbeVersion = localPckg?.version || 'not found'

    console.log('OS')
    console.log(`  name: ${osName}`)
    console.log(`  arch: ${osArch}`)
    console.log(`  version: ${osVersion}`)
    console.log('Bun')
    console.log(`  version: ${bunVersion}`)
    console.log(`  revision: ${bunRevision}`)
    console.log('Galbe')
    console.log(`  version: ${galbeVersion}`)
  })
}
