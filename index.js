import * as fs from 'fs'
import * as gql from "graphql"
import { parseArgs } from "node:util"
import path from 'path'
import * as R from 'ramda'

const help = `usage:
  node index.js --help
  node index.js <input> [--output=<output>] [--with-utils]

Argument:
  <input>             File or folder. If folder, read all graphql files (not recursive).

Options:
  --output=<output>   File or folder. If folder, automatically named the output file.
                      If undefined, print the result on the standard output.
  --with-utils      Include the utils functions in the results.
`

const options = {
  'help': {
    type: 'boolean',
    short: 'h',
    default: false
  },
  'with-utils': {
    type: 'boolean',
    default: false
  },
  'output': {
    type: 'string',
    short: 'o'
  }
}

const enums_defs_header = `
--
-- ENUMS DEFINTIONS
--
`

const objects_defs_header = `
--
-- TYPES DEFINTIONS
--
`

const enums_conv_header = `
--
-- ENUMS STRING CONVERSIONS
--
`

const enums_dec_header = `
--
-- ENUMS DECODERS
--
`

const objects_dec_header = `
--
-- TYPES DECODERS
--
`

main()

function main() {
  const { values, positionals } = parseArgs({ options, allowPositionals: true })
  if (R.propOr(false, 'help', values)) {
    console.log(help)
    process.exit(0)
  }
  if (positionals.length !== 1) {
    console.log('invalid arguments')
    console.log(help)
    process.exit(1)
  }
  const input = positionals[0]
  const output = R.propOr(null, 'output', values)
  const with_utils = R.propOr(false, 'with-utils', values)

  if (fs.lstatSync(input).isDirectory()) {
    const inputs = read_files(input)
    inputs.forEach(x => run(x, output, with_utils))
    process.exit(0)
  } else {
    run(input, output, with_utils)
  }
}

function read_files(folder) {
  return fs.readdirSync(folder)
    .filter(x => path.extname(x) === '.graphql' || path.extname(x) === '.gql')
    .map(x => path.join(folder, x))
}

export function run(input, output = null, with_utils = false) {
  const bf = fs.readFileSync(input, { encoding: 'utf-8' })
  const doc = gql.parse(bf)
  const enums = get_enums(doc.definitions)
  const objects = get_objects(doc.definitions)
  const inputs = get_inputs(doc.definitions)
  const module_name = to_pascal_case(path.basename(input, path.extname(input)))
  const out = write_res(module_name, enums, objects, inputs, with_utils)

  // Stdout
  if (R.isNil(output)) {
    console.log(out)
    return
  }

  // Autoname ?
  const stat = fs.lstatSync(output, { throwIfNoEntry: false })
  const dest = stat && stat.isDirectory() ? path.format({
    root: output,
    name: module_name,
    ext: '.elm'
  }) : output

  console.log(`Output: ${dest}`)
  fs.writeFileSync(dest, out)
}


export function write_res(module_name, enums, objects, inputs, with_utils = false) {
  return `module ${module_name} exposing (..)

${enums.length === 0 ? '' : enums_defs_header}
${enums.map(write_enum_type).join('\n')}

${objects.length === 0 ? '' : objects_defs_header}
${objects.map(write_object_type).join('\n')}

${enums.length === 0 ? '' : enums_conv_header}
${enums.map(write_enum_str).join('\n')}

${enums.length === 0 ? '' : enums_dec_header}
${enums.map(write_enum_dec).join('\n')}

${objects.length === 0 ? '' : objects_dec_header}
${objects.map(write_object_dec).join('\n')}
` + (with_utils ? `
--
-- UTILS
--
${write_utils()}
` : '')
}


export function write_input_type({ name, values }) {
  const vs = values.map(to_pascal_case).join(' | ')
  return `type ${name} = ${vs}`
}


export function write_enum_type({ name, values }) {
  const vs = values.map(to_pascal_case).join(' | ')
  return `type ${name} = ${vs}`
}


export function write_enum_str({ name, values }) {
  const vc = values.map(x => `        ${to_pascal_case(x)} ->\n            "${x}"\n`)
  const vf = values.map(x => `        "${x}" ->\n            Just ${to_pascal_case(x)}\n`)

  return `
${to_camel_case(name)}ToString : ${name} -> String
${to_camel_case(name)}ToString x =
    case x of
${vc.join("\n")}

${to_camel_case(name)}FromString : String -> Maybe ${name}
${to_camel_case(name)}FromString x =
    case x of
${vf.join("\n")}
        _ ->
            Nothing
`
}


export function write_enum_dec({ name, values }) {
  return `
decode${name} : Decoder ${name}
decode${name} =
    decodeString ${to_camel_case(name)}FromString
`
}


export function write_object_type({ name, fields }) {
  return `type alias ${name} = {
${fields.map(write_object_field_def).join(',\n')}
}
`
}


export function write_object_dec({ name, fields }) {
  return `
decode${name} : Decoder ${name}
decode${name} =
    Decoder.succeed ${name}
${fields.map(write_object_field_dec).join(',\n')}
`
}


function write_object_field_def({ name, type, is_required, is_list }) {
  return `    ${to_camel_case(name)}: ${is_list ? 'List ' : ''}${is_required || is_list ? '' : 'Maybe '}${map_type(type)}` // never List (Maybe T), always List T
}


function write_object_field_dec({ name, type, is_required, is_list }) {
  return `        |> required "${name}" ${map_decoder(name, type, is_required, is_list)}`
}


export function write_utils() {
  return `
decodeString : (String -> Maybe a) -> Decoder a
decodeString map =
    Decode.string
        |> Decode.andThen
            (\\x ->
                case map x of
                    Just v ->
                        Decode.succeed v

                    Nothing ->
                        Decode.fail <| "invalid value: " ++ x
            )
`
}


function map_type(type) {
  switch (type) {
    case 'Boolean':
      return 'Bool'
    default:
      return type
  }
}


function map_decoder(name, type, is_required, is_list) {
  const r = is_required || is_list ? '' : 'Decode.nullable ' // never List (Maybe T), always List T
  const l = is_list ? 'Decode.list ' : ''
  switch (type) {
    case 'Boolean':
      return `${r}${l}Decode.bool`
    case 'String':
      return `${r}${l}Decode.string`
    case 'Int':
      return `${r}${l}Decode.int`
    case 'Float':
      return `${r}${l}Decode.float`
    default:
      return `${r}${l}decode${type}`
  }
}


//
// Utils
//

function to_pascal_case(x) {
  return x
    .replaceAll('_', ' ')
    .replaceAll(/(\w)(\w*)/g, (_, g1, g2) => g1.toUpperCase() + g2.toLowerCase())
    .replaceAll(' ', '')
}


function to_camel_case(x) {
  return x
    .replaceAll('_', ' ')
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 ? word.toLowerCase() : word.toUpperCase())
    .replace(/\s+/g, '')
}


//
// AST
//

/*
kind
  - EnumTypeDefinition
  - ObjectTypeDefinition
  - UnionTypeDefinition
  - InputObjectTypeDefinition
  - ScalarTypeDefinition
  - EnumValueDefinition
  - FieldDefinition
*/

function get_enums(def) {
  return def
    .filter(x => x.kind === 'EnumTypeDefinition').map(x => ({
      name: x.name.value,
      values: x.values.filter(x => x.kind === 'EnumValueDefinition').map(x => x.name.value)
    }))
}

function get_objects(def) {
  return def
    .filter(x => x.kind === 'ObjectTypeDefinition')
    .map(x => ({
      name: x.name.value,
      fields: x.fields.map(f => ({ ...get_type(f), name: f.name.value }))
    }))
}

function get_inputs(def) {
  return def
    .filter(x => x.kind === 'InputObjectTypeDefinition')
    .map(x => ({
      name: x.name.value,
      fields: x.fields.map(f => ({ ...get_type(f), name: f.name.value }))
    }))
}


function get_type(f, is_list = false) {
  const k = R.path(['type', 'kind'], f)

  if (f.kind === 'NamedType') {
    return {
      type: f.name.value,
      is_required: f.name.loc.startToken.next.kind === '!',
      is_list: is_list,
    }
  }
  switch (k) {
    case 'NamedType':
      return {
        type: f.type.name.value,
        is_required: f.type.name.loc.startToken.next.kind === '!',
        is_list: is_list,
      }
    case 'NonNullType':
      return get_type(f.type, is_list)
    case 'ListType':
      return get_type(f.type.type, true)
    default:
      console.log(f)
      throw new Error('unexpected field')
  }
}
