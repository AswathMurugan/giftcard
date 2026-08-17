import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"

const GENERATED_TYPE_BARRELS: Record<string, string> = {
  "@/types/entities": "src/types/entities/index.ts",
  "@/types/enumerations": "src/types/enumerations/index.ts",
  "@/types/partner-modules": "src/types/partner-modules/index.ts",
  "@/types/saved-queries": "src/types/saved-queries/index.ts",
  "@/types/workflows": "src/types/workflows/index.ts",
}

function resolveModuleFile(basePath: string): string | undefined {
  for (const candidate of [basePath, `${basePath}.ts`, `${basePath}.tsx`]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function directModuleId(barrelId: string, reexportPath: string): string {
  const suffix = reexportPath.replace(/^\.\//, "")
  return path.posix.join(barrelId, suffix)
}

function exportedNames(source: string): string[] {
  const names: string[] = []
  const declaration =
    /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|class|function|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
  for (const match of source.matchAll(declaration)) names.push(match[1])
  return names
}

function barrelExportMap(
  projectRoot: string,
  barrelId: string,
  barrelFile: string
): Map<string, string> {
  const absoluteBarrel = path.resolve(projectRoot, barrelFile)
  if (!existsSync(absoluteBarrel)) return new Map()

  const source = readFileSync(absoluteBarrel, "utf8")
  const exports = new Map<string, string>()
  const explicit = /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  const exportAll = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g

  for (const match of source.matchAll(explicit)) {
    const moduleId = directModuleId(barrelId, match[2])
    for (const rawSpecifier of match[1].split(",")) {
      const specifier = rawSpecifier.trim().replace(/^type\s+/, "")
      if (!specifier) continue
      const parts = specifier.split(/\s+as\s+/)
      exports.set((parts[1] ?? parts[0]).trim(), moduleId)
    }
  }

  for (const match of source.matchAll(exportAll)) {
    const reexportPath = match[1]
    const moduleFile = resolveModuleFile(
      path.resolve(path.dirname(absoluteBarrel), reexportPath)
    )
    if (!moduleFile) continue
    const moduleId = directModuleId(barrelId, reexportPath)
    for (const name of exportedNames(readFileSync(moduleFile, "utf8"))) {
      exports.set(name, moduleId)
    }
  }

  return exports
}

function importedName(specifier: string): string {
  return specifier
    .replace(/^type\s+/, "")
    .split(/\s+as\s+/)[0]
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Vite serves local source as native ESM in development, so importing one
 * symbol from an `export *` barrel otherwise evaluates every generated module.
 * Rewrite named imports to their exact generated module before import analysis.
 */
export function rewriteGeneratedTypeImports(
  source: string,
  projectRoot: string
): string {
  let transformed = source

  for (const [barrelId, barrelFile] of Object.entries(GENERATED_TYPE_BARRELS)) {
    if (!transformed.includes(barrelId)) continue

    const exports = barrelExportMap(projectRoot, barrelId, barrelFile)
    if (exports.size === 0) continue

    const importPattern = new RegExp(
      `import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+(['"])${escapeRegExp(barrelId)}\\3\\s*;?`,
      "g"
    )

    transformed = transformed.replace(
      importPattern,
      (statement, typeOnly: string | undefined, body: string) => {
        if (typeOnly) return statement

        const groups = new Map<string, string[]>()
        for (const rawSpecifier of body.split(",")) {
          const specifier = rawSpecifier.trim()
          if (!specifier) continue
          const moduleId = exports.get(importedName(specifier)) ?? barrelId
          const group = groups.get(moduleId) ?? []
          group.push(specifier)
          groups.set(moduleId, group)
        }

        if (groups.size === 1 && groups.has(barrelId)) return statement
        return [...groups]
          .map(
            ([moduleId, specifiers]) =>
              `import { ${specifiers.join(", ")} } from '${moduleId}';`
          )
          .join("\n")
      }
    )
  }

  return transformed
}

export function selectiveGeneratedTypeImportsPlugin(): Plugin {
  let projectRoot = process.cwd()

  return {
    name: "jiffy-selective-generated-type-imports",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root
    },
    transform(source, id) {
      const sourceRoot = `${path.resolve(projectRoot, "src")}${path.sep}`
      const file = id.split("?", 1)[0]
      if (!file.startsWith(sourceRoot) || !source.includes("@/types/"))
        return null

      const code = rewriteGeneratedTypeImports(source, projectRoot)
      return code === source ? null : { code, map: null }
    },
  }
}
