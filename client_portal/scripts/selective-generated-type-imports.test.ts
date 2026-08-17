import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { rewriteGeneratedTypeImports } from "./selective-generated-type-imports"

let roots: string[] = []

function projectRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "selective-types-"))
  roots.push(root)
  return root
}

function write(root: string, relativePath: string, source: string): void {
  const file = path.join(root, relativePath)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe(
  "selective generated type imports",
  { tags: ["generated-types", "logic"] },
  () => {
    it(
      "imports only the requested enum modules",
      { tags: ["important"] },
      () => {
        const root = projectRoot()
        write(
          root,
          "src/types/enumerations/index.ts",
          "export * from './app/status';\nexport * from './app/category';\n"
        )
        write(
          root,
          "src/types/enumerations/app/status.ts",
          "export const STATUS_VALUES = ['Open'] as const;\nexport type Status = typeof STATUS_VALUES[number];\n"
        )
        write(
          root,
          "src/types/enumerations/app/category.ts",
          "export const CATEGORY_VALUES = ['A'] as const;\nexport type Category = typeof CATEGORY_VALUES[number];\n"
        )

        const source = `import { STATUS_VALUES, type Status } from '@/types/enumerations';`
        const result = rewriteGeneratedTypeImports(source, root)

        expect(result).toBe(
          `import { STATUS_VALUES, type Status } from '@/types/enumerations/app/status';`
        )
        expect(result).not.toContain("category")
      }
    )

    it(
      "splits symbols belonging to different generated modules",
      { tags: ["edge-case"] },
      () => {
        const root = projectRoot()
        write(
          root,
          "src/types/enumerations/index.ts",
          "export * from './app/status';\nexport * from './app/category';\n"
        )
        write(
          root,
          "src/types/enumerations/app/status.ts",
          "export const STATUS_VALUES = [];\n"
        )
        write(
          root,
          "src/types/enumerations/app/category.ts",
          "export const CATEGORY_VALUES = [];\n"
        )

        const source = `import { STATUS_VALUES, CATEGORY_VALUES as categories } from '@/types/enumerations';`
        const result = rewriteGeneratedTypeImports(source, root)

        expect(result).toContain(
          `import { STATUS_VALUES } from '@/types/enumerations/app/status';`
        )
        expect(result).toContain(
          `import { CATEGORY_VALUES as categories } from '@/types/enumerations/app/category';`
        )
        expect(result).not.toContain(`from '@/types/enumerations';`)
      }
    )

    it(
      "does not consume an earlier unrelated named import",
      { tags: ["edge-case"] },
      () => {
        const root = projectRoot()
        write(
          root,
          "src/types/enumerations/index.ts",
          "export * from './app/status';\n"
        )
        write(
          root,
          "src/types/enumerations/app/status.ts",
          "export const STATUS_VALUES = [];\n"
        )

        const source = [
          `import { useState } from 'react';`,
          `import { STATUS_VALUES } from '@/types/enumerations';`,
        ].join("\n")
        const result = rewriteGeneratedTypeImports(source, root)

        expect(result).toBe(
          [
            `import { useState } from 'react';`,
            `import { STATUS_VALUES } from '@/types/enumerations/app/status';`,
          ].join("\n")
        )
      }
    )

    it(
      "resolves generated async execute functions",
      { tags: ["important"] },
      () => {
        const root = projectRoot()
        write(
          root,
          "src/types/saved-queries/index.ts",
          "export * from './app/rep_code_list';\nexport * from './app/unused_query';\n"
        )
        write(
          root,
          "src/types/saved-queries/app/rep_code_list.ts",
          "export async function executeRepCodeList() {}\n"
        )
        write(
          root,
          "src/types/saved-queries/app/unused_query.ts",
          "export async function executeUnusedQuery() {}\n"
        )

        const source = `import { executeRepCodeList } from '@/types/saved-queries';`
        const result = rewriteGeneratedTypeImports(source, root)

        expect(result).toBe(
          `import { executeRepCodeList } from '@/types/saved-queries/app/rep_code_list';`
        )
        expect(result).not.toContain("unused_query")
      }
    )

    it(
      "resolves explicit type re-exports without changing type-only imports",
      { tags: ["smoke"] },
      () => {
        const root = projectRoot()
        write(
          root,
          "src/types/entities/index.ts",
          "export type { Account, AccountSchema as WealthAccountSchema } from './wealth/account';\n"
        )

        const source = `import type { Account, WealthAccountSchema } from '@/types/entities';`
        expect(rewriteGeneratedTypeImports(source, root)).toBe(source)
      }
    )

    it(
      "copies scripts into local session workspaces",
      { tags: ["smoke"] },
      () => {
        const sessionScript = readFileSync(
          new URL("./new-session.sh", import.meta.url),
          "utf8"
        )

        expect(sessionScript).toContain("rsync -a")
        expect(sessionScript).not.toContain("--exclude=scripts")
      }
    )
  }
)
