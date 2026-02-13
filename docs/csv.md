# CSV

The CSV library (`@/core/lib/csv`) parses and validates CSV files against a Zod schema. It accepts local file paths or URLs and returns fully typed rows.

## Usage

```ts
import * as z from 'zod';
import { attempt, isError } from '@/core/lib/attempt/index.ts';
import { parseCsv } from '@/core/lib/csv/index.ts';

const schema = z.object({
  Name: z.string().min(1, 'Name is required'),
  Email: z.string(),
});

const result = await attempt(() => parseCsv(source, schema));

if (isError(result)) {
  // result.error is a CsvError with .code and .message
  return;
}

for (const row of result.data) {
  row.Name; // typed as string
}
```

Schema keys define expected CSV headers. Extra CSV columns are ignored; missing columns throw `MISSING_HEADERS`. All CSV values are strings -- design schemas accordingly.

## Error Codes

`parseCsv` throws `CsvError` on failure. Use `attempt()` to catch. Each error has a `code`:

| Code | When |
| --- | --- |
| `INVALID_FILE_TYPE` | Source is not a `.csv` file and URL content type is not `text/csv` or `text/plain` |
| `FETCH_FAILED` | Network error, non-OK response, or file not found |
| `PARSE_ERROR` | Malformed CSV that cannot be parsed (e.g. unclosed quotes) |
| `EMPTY_CSV` | No data rows (header-only or empty file) |
| `MISSING_HEADERS` | CSV is missing headers expected by the schema |
| `VALIDATION_FAILED` | One or more rows failed schema validation (message includes per-row details) |

## CSV Format

- Comma-delimited fields
- Quoted fields may contain commas: `"Smith, John"`
- Escaped quotes via `""`: `"She said ""hello"""`
- Leading/trailing whitespace is trimmed
- Quoted fields may contain newlines
- CRLF line endings are normalized

## API

### `parseCsv(source, schema)`

| Parameter | Type | Description |
| --- | --- | --- |
| `source` | `string` | Local file path or URL |
| `schema` | `z.ZodObject` | Zod object schema defining expected row shape |
| **Returns** | `Promise<z.infer<T>[]>` | Array of validated, typed row objects |
| **Throws** | `CsvError` | On any validation or fetch failure |

### `CsvError`

Extends `Error`. Properties: `code` (`CsvErrorCode`), `message` (`string`), `cause` (`unknown`).
