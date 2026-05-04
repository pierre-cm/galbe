import { Command, Option } from 'commander'
import { fmtVal, toPascalCase } from '../../util'
import { SQL } from 'bun'
import { mkdirSync } from 'fs'
import path from 'path'

const TYPE_MAP: Record<string, string> = {
  // --- Postgres + MySQL numerics ---
  smallint: 'number',
  integer: 'number',
  int: 'number',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  bigint: 'bigint', // or 'number' ?
  decimal: 'number',
  numeric: 'number',
  real: 'number',
  float: 'number',
  float4: 'number',
  float8: 'number',
  double: 'number',
  'double precision': 'number',
  serial: 'number',
  bigserial: 'number',
  smallserial: 'number',
  tinyint: 'number',
  mediumint: 'number',
  bit: 'number',

  // --- Strings ---
  text: 'string',
  'character varying': 'string',
  varchar: 'string',
  character: 'string',
  char: 'string',
  citext: 'string',
  enum: 'string',
  set: 'string',
  tinytext: 'string',
  mediumtext: 'string',
  longtext: 'string',

  // --- Binary ---
  bytea: 'Buffer',
  blob: 'Buffer',
  tinyblob: 'Buffer',
  mediumblob: 'Buffer',
  longblob: 'Buffer',
  binary: 'Buffer',
  varbinary: 'Buffer',

  // --- Booleans ---
  boolean: 'boolean',

  // --- Date/Time ---
  date: 'Date | string',
  datetime: 'Date | string',
  timestamp: 'Date | string',
  'timestamp without time zone': 'Date | string',
  'timestamp with time zone': 'Date | string',
  time: 'string',
  'time without time zone': 'string',
  'time with time zone': 'string',
  interval: 'string',
  year: 'number',

  // --- JSON ---
  json: 'any',
  jsonb: 'any',

  // --- UUID ---
  uuid: 'string',

  // --- Spatial / geometric ---
  point: 'any',
  line: 'any',
  lseg: 'any',
  box: 'any',
  path: 'any',
  polygon: 'any',
  circle: 'any',
  geometry: 'any',
  linestring: 'any',
  multipoint: 'any',
  multilinestring: 'any',
  multipolygon: 'any',
  geometrycollection: 'any',

  // --- Other ---
  xml: 'string',
  money: 'string',
  tsvector: 'string',
  tsquery: 'string',
  inet: 'string',
  cidr: 'string',
  macaddr: 'string',
  macaddr8: 'string',
  array: 'any[]',
}

export default (cmd: Command) => {
  cmd
    .description('generate TypeScript types from a database')
    .addOption(
      new Option(
        '-u, --url <connection_url>',
        `database connection url (ex. ${fmtVal('postgres://postgres:secret@localhost:5432')})`
      ).makeOptionMandatory()
    )
    .addOption(new Option('-t, --table <table_name>', `table name (ex. users or public.users)`))
    .addOption(new Option('-s, --schema <schema_name>', `schema name (ex. public)`).default('public', fmtVal('public')))
    .addOption(new Option('-o, --out <dir|file>', 'output dir or file').default('.', fmtVal('.')))
    .addOption(new Option('-F, --force', 'force overriding output'))
    .action(async props => {
      const { url, table, schema, out, force } = props

      const db = new SQL({ url })
      let tables: string[] = []
      let types: Record<string, string> = {}

      if (table) tables = [table]
      else {
        const r = await db.unsafe(`SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = '${schema}'
          AND table_type = 'BASE TABLE'`)
        tables = r.map((r: Record<string, string>) => r.table_name)
      }

      for (const tableName of tables) {
        const t = await db.unsafe(`SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = '${schema}' AND table_name = '${tableName}'`)
        types[tableName] = `type ${toPascalCase(tableName)} = {\n${t
          .map((r: Record<string, string>) => `  ${r.column_name}: ${TYPE_MAP?.[r.data_type] ?? 'any'}${r.is_nullable ? ' | null' : ''}`)
          .join(';\n')}\n}`
      }

      mkdirSync(path.dirname(out), { recursive: true })

      if (path.extname(out) === '.ts') {
        await Bun.write(
          out,
          Object.values(types).map(type => `export ${type}\n`)
        )
      } else {
        for (const [tableName, type] of Object.entries(types)) {
          await Bun.write(`${out}/${tableName}.ts`, `export ${type}\n`)
        }
      }
    })
}
