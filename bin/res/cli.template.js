#!/usr/bin/env bun

import { program, Option } from 'commander'
import { resolve } from 'path'

const DEFAULT_HEADERS = {
  'user-agent': 'Galbe//*%(()=>version)()%*//cli',
}
const ansi = (p, c, str) => (p ? `\x1b[${c}m${str}\x1b[0m` : str)

const fmtObject = (o, p = false, idt = 2, iidt = 0) => {
  let _ = ' '.repeat(iidt)
  let __ = ' '.repeat(iidt + idt)
  let lr = idt === 0 ? '' : '\n'
  if (o === null) return ansi(p, '38;2;255;128;0', 'null')
  if (typeof o === 'boolean') return o ? ansi(p, '38;2;255;128;0', 'true') : ansi(p, '38;2;255;128;0', 'false')
  if (typeof o === 'number') return ansi(p, '38;2;10;180;220', o)
  if (typeof o === 'string') return ansi(p, '38;2;125;170;0', `"${o}"`)
  if (typeof o === 'object') {
    if (Array.isArray(o))
      return `[${lr}${o.map(e => `${__}${fmtObject(e, p, idt, iidt + idt)}`).join(`,${lr}`)}${lr}${_}]`
    return `{${lr}${Object.entries(o)
      .map(([k, v]) =>
        v === undefined ? '' : `${__}${ansi(p, '38;2;170;120;200', `"${k}"`)}: ${fmtObject(v, p, idt, iidt + idt)}`
      )
      .filter(l => l)
      .join(`,${lr}`)}${lr}${_}}`
  }
}
const fmtRes = (r, p = false) => {
  if (typeof r === 'object') {
    try {
      let resp = fmtObject(r, p, 2)
      return Bun.write(Bun.stdout, `${resp}\n`)
    } catch (err) {
      console.error(err)
      return Bun.write(Bun.stdout, `${r}\n`)
    }
  }
  if (!p) return Bun.write(Bun.stdout, `${r}\n`)
  if (typeof r === 'boolean') return Bun.write(Bun.stdout, `${ansi(p, '38;2;255;128;0', r)}\n`)
  if (typeof r === 'number') return Bun.write(Bun.stdout, `${ansi(p, '38;2;10;180;220', r)}\n`)
  if (typeof r === 'string') return Bun.write(Bun.stdout, `${ansi(p, '38;2;125;170;0', r)}\n`)
  return Bun.write(Bun.stdout, `${r}\n`)
}

const fetchApi = async (method, path, props) => {
  let headers = Object.fromEntries(props?.['%header'].map(s => s.split('=')))
  let queryParam = Object.fromEntries(props?.['%query'].map(s => s.split('=')))
  let body = props?.['%body']
  let bodyFile = props?.['%bodyFile']
  let format = new Set(props?.['%format'])

  delete props?.['%header']
  delete props?.['%query']
  delete props?.['%body']
  delete props?.['%bodyFile']
  delete props?.['%format']

  const queryString = Object.entries({ ...queryParam, ...props })
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&')

  if (!Bun.env.GCLI_SERVER_URL) {
    console.error('error: Missing GCLI_SERVER_URL env')
    return process.exit(1)
  }
  let url = `${Bun.env.GCLI_SERVER_URL}${path}?${queryString}`
  if (bodyFile) body = await Bun.file(resolve(process.cwd(), bodyFile)).arrayBuffer()
  let startTime = Bun.nanoseconds()
  let res = await fetch(url, {
    method,
    headers: {
      ...DEFAULT_HEADERS,
      ...(bodyFile ? { 'content-type': 'application/octet-stream' } : {}),
      ...(headers || {}),
    },
    ...(body ? { body } : {}),
  })
  let endTime = Bun.nanoseconds() - startTime
  if (format.has('s')) fmtRes(res.status, format.has('p'))
  if (format.has('h')) fmtRes(Object.fromEntries(res.headers.entries()), format.has('p'))
  if (format.has('b')) {
    let isJson = res.headers.get('content-type') === 'application/json'
    if (isJson) fmtRes(await res.json(), format.has('p'))
    else if (res.headers.get('content-type')?.match(/^text\//)) fmtRes(await res.text(), format.has('p'))
    else Bun.write(Bun.stdout, await res.arrayBuffer())
  }
  if (format.has('t')) Bun.write(Bun.stdout, `${(endTime / 1_000_000).toFixed(2)}ms\n`)
  process.exit(res.ok ? 0 : 1)
}

program.name('/*%(()=>name)()%*/').description('/*%(()=>description)()%*/').version('/*%(()=>version)()%*/')
/*%
const formatDefault = def =>
  typeof def === 'string'
    ? `\`${def}\``
    : Array.isArray(def)
    ? `[${def.map(d => formatDefault(d)).join(',')}]`
    : def ?? 'undefined';

result = Object.entries(tags).map(([tag, commands])=>{
  return (tag?`const _${tag} = program.command('${tag}');\n`:'')+commands.map(c=>{
    let args = c.arguments.map(a=>`.argument("${a.name}", "${JSON.stringify(a.description).slice(1,-1) || a.name+' argument' || ''}")`)
    let optionsBase = [
      {name: '%format', short:'%f', type: '[string]', description: 'response format [\'s\',\'h\',\'b\',\'t\',\'p\']', default:["s","b","p"]},
      {name: '%header', short:'%h', type: '<string...>', description: 'request header formated as headerName=headerValue', default:[]},
      {name: '%query', short:'%q', type: '<string...>', description: 'query param formated as paramName=paramValue', default:[]},
      {name: '%body', short:'%b', type: '<string>', description: 'request body', default:''},
      {name: '%bodyFile', short:'%bf', type: '<path>', description: 'request body file', default:''}
    ]
    let options = [...optionsBase,...(c.options||[])].map(o=>`.addOption(new Option("-${o.short}, --${o.name} ${o.type}", "${JSON.stringify(o.description).slice(1,-1)}").default(${formatDefault(o.default)}))`)
    let action = `.action(async (${c.arguments.map(a=>`${a.name},`).join('')} props) => {
      ${c.action ? ';('+c.action.toString()+')(props)' : ''}
      return await fetchApi("${c.route.method.toUpperCase()}",\`${c.route.pathT}\`, props)
    })`
    return `${tag?`_${tag}`:'program'}.command("${c.name}").description("${JSON.stringify(c.description).slice(1,-1)}")${args.join('')}${options.join('')}${action}`
  }).join(';\n')
})
%*/

program.parse()
