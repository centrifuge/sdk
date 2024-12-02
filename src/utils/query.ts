export function hashKey(key: any[]): string {
  return JSON.stringify(key, (_, val) =>
    isPlainObject(val)
      ? // Order the keys in the object alphabetically
        Object.keys(val)
          .sort()
          .reduce((result, key) => {
            result[key] = val[key]
            return result
          }, {} as any)
      : jsonFormatter(val)
  )
}

function jsonFormatter(nestedValue: any) {
  return typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue
}

function isObject(o: any) {
  return Object.prototype.toString.call(o) === '[object Object]'
}

// Copied from: https://github.com/jonschlinkert/is-plain-object
function isPlainObject(o: any) {
  if (isObject(o) === false) return false

  // If has modified constructor
  const ctor = o.constructor
  if (ctor === undefined) return true

  // If has modified prototype
  const prot = ctor.prototype
  if (isObject(prot) === false) return false

  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty('isPrototypeOf') === false) {
    return false
  }

  // Most likely a plain Object
  return true
}
