import { HttpStatus, pckg } from '../../../util'
import { Galbe } from '../../../../src'
import { walkRoutes } from '../../../../src/util'
import {
  Kind,
  Optional,
  STArray,
  STJson,
  STLiteral,
  STObject,
  STProps,
  STSchema,
  STUnion
} from '../../../../src/schema'
import { OpenAPIV3 } from 'openapi-types'

const parsePckgAuthoRgx = /^\s*([^<(]*)(?:<([^>]+)>)?\s*(?:\(([^)]*)\))?\s*$/

const parseAuthor = (author: { name: string; url: string; email: string } | string) => {
  if (!author) return undefined
  if (typeof author === 'string') {
    let m = author.match(parsePckgAuthoRgx)
    if (!m) return undefined
    const [_, name, email, url] = m
    return { name: name?.trim(), email: email?.trim(), url: url?.trim() }
  }
  return author
}

const schemaToMedia = ({ type, format, isJson }) =>
  isJson || (type && ['object', 'number', 'boolean', 'array'].includes(type))
    ? 'application/json'
    : format === 'byte'
    ? 'application/octet-stream'
    : type === 'string'
    ? 'text/plain'
    : '*/*'

export const galbeToOpenapi = (g: Galbe, version = '3.0.3') => {
  let paths = {}
  let components = {
    schemas: {},
    parameters: {},
    requestBodies: {},
    responses: {}
  }

  const schemaToOpenapi = (
    schema: STSchema
  ): { schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject; isJson?: boolean } => {
    let s = {}
    let kind = schema[Kind]
    let isJson = false

    if ((schema.id as string) in components.schemas) {
      //@ts-ignore
      return { schema: { $ref: `#/components/schemas/${schema.id}` } }
    }
    // TODO add constraints min, max etc.
    if (kind === 'boolean') s = { type: 'boolean' }
    else if (kind === 'byteArray') s = { type: 'string', format: 'byte' } // Verify that
    else if (kind === 'number') s = { type: 'number' }
    else if (kind === 'integer') s = { type: 'integer' }
    else if (kind === 'string') s = { type: 'string' }
    else if (kind === 'any') s = { type: 'string' }
    else if (kind === 'literal') {
      let value = (schema as STLiteral).value
      s = { type: 'string', enum: [value] }
    } else if (kind === 'array') {
      s = { type: 'array', items: schemaToOpenapi((schema as STArray).items).schema }
    } else if (kind === 'object') {
      let props = (schema as STObject).props || {}
      let required = Object.entries(props)
        .filter(([_, v]) => !v?.[Optional])
        .map(([k, _]) => k)
      s = {
        type: 'object',
        properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, schemaToOpenapi(v).schema])),
        ...(required.length ? { required } : {})
      }
    } else if (kind === 'json') {
      let props = ((schema as STJson).props || {}) as STProps
      let type = (schema as STJson).type
      if (type === 'unknown') type = 'object'
      let required = Object.entries(props)
        .filter(([_, v]) => !v?.[Optional])
        .map(([k, _]) => k)
      isJson = true
      s = {
        type: type,
        ...(type === 'object'
          ? {
              properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, schemaToOpenapi(v).schema])),
              ...(required.length ? { required } : {})
            }
          : {})
      }
    } else if (kind === 'union') {
      let anyOf = (schema as STUnion).anyOf
      s = {
        anyOf: anyOf.map(s => schemaToOpenapi(s).schema)
      }
    }
    s = { title: schema.title, description: schema.description, ...s }
    if (schema.id) {
      components.schemas[schema.id] = s
      //@ts-ignore
      return { schema: { $ref: `#/components/schemas/${schema.id}` } }
    }
    return { schema: s, isJson }
  }

  const resolveRef = (schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): OpenAPIV3.SchemaObject => {
    if (!(schema as OpenAPIV3.ReferenceObject)?.$ref) return schema as OpenAPIV3.SchemaObject
    let ref = (schema as OpenAPIV3.ReferenceObject)?.$ref
    let match = ref.match('^#/components/(schemas|requestBodies|responses)/(.*)$')
    if (!match) throw new Error(`Invalid schema ref ${ref}`)
    let [_, kind, refPath] = match
    return refPath.split('/').reduce((c, k) => {
      if (k in c) return c[k]
      else return undefined
    }, components[kind])
  }

  const parseParam = (key: string, param: STSchema, kind: 'query' | 'header' | 'path' | 'cookie') => {
    let { schema } = schemaToOpenapi({ ...param, [Optional]: false })
    let p: OpenAPIV3.ParameterObject = {
      name: key,
      in: kind,
      description: param?.description,
      required: kind === 'path' ? true : !param[Optional] || undefined,
      deprecated: param.deprecated,
      schema
    }
    if (param.id) components.parameters[param.id] = p
    return p
  }

  const metaRoutes = g.meta?.reduce(
    (routes, c) => ({ ...routes, ...c.routes }),
    {} as Record<string, Record<string, Record<string, any>>>
  )
  for (let [_, node] of Object.entries(g.router.routes)) {
    walkRoutes(node, r => {
      let meta = metaRoutes?.[r.path]?.[r.method]
      let path = r.path.replaceAll(/:([^\/]+)/g, '{$1}')
      if (!(path in paths)) paths[path] = { summary: 'undefined' }
      let tags = [...(meta?.tags?.split(' ')?.map(t => t.trim()) || []), ...(meta?.tag || [])]
      let pathParam = r.schema?.params
        ? Object.entries(r.schema?.params as Record<string, STSchema>).map(([k, v]) => parseParam(k, v, 'path'))
        : []
      let queryParam = r.schema?.query
        ? Object.entries(r.schema?.query as Record<string, STSchema>).map(([k, v]) => parseParam(k, v, 'query'))
        : []
      let headerParam = r.schema?.headers
        ? Object.entries(r.schema?.headers as Record<string, STSchema>).map(([k, v]) => parseParam(k, v, 'header'))
        : []
      // TODO cookieParam
      let parameters = [...pathParam, ...queryParam, ...headerParam]

      let requestBody
      if (r.schema.body) {
        let { schema, isJson } = schemaToOpenapi(r.schema.body)
        let { type, format } = resolveRef(schema)
        let media = schemaToMedia({ type, format, isJson })
        requestBody = {
          description: r.schema.body.description,
          required: !r.schema.body[Optional],
          content: {
            [media]: { schema }
          }
        }
        if (r.schema.body.id) {
          components.requestBodies[r.schema.body.id] = requestBody
          requestBody = { $ref: `#/components/requestBodies/${r.schema.body.id}` }
        }
      }
      let responses
      if (r.schema.response && Object.keys(r.schema.response).length) {
        responses = Object.fromEntries(
          Object.entries(r.schema.response).map(([s, v]) => {
            let { schema, isJson } = schemaToOpenapi(v)
            let { type, format } = resolveRef(schema)
            let media = schemaToMedia({ type, format, isJson })
            let response: OpenAPIV3.ResponseObject = {
              description: v.description || HttpStatus[s] || 'Response',
              content: { [media]: { schema: schema } }
            }
            if (r.schema.response?.[s].id) {
              components.responses[r.schema.response?.[s].id] = response
              //@ts-ignore
              response = { $ref: `#/components/responses/${r.schema.response?.[s].id}` }
            }
            return [s, response]
          })
        )
      } else {
        responses = {
          default: { description: HttpStatus[200] }
        }
      }
      paths[path][r.method] = {
        tags: tags.length ? tags : undefined,
        summary: meta?.head,
        operationId: meta?.operationId,
        parameters: parameters.length ? parameters : undefined,
        requestBody,
        responses,
        deprecated: meta?.deprecated ? true : undefined
      }
    })
  }
  //@ts-ignore
  components = Object.entries(components).reduce((p, [k, v]) => {
    if (Object.keys(v).length) p[k] = v
    return p
  }, {})
  return {
    openapi: version,
    info: {
      title: pckg?.name || 'Galbe app API',
      description: pckg?.description,
      contact: parseAuthor(pckg.author),
      //license: TODO
      version: pckg?.version || '0.1.0'
    },
    paths,
    components: Object.keys(components)?.length ? components : undefined
  }
}
