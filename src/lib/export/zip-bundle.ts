import { generateSiigoExcel, getSiigoConfig, validateSiigoExport } from "./siigo-export";
import { generateSummaryExcel } from "./summary-export";
import archiver from "archiver";
import { Readable } from "stream";

/** Generate both files as a ZIP buffer */
export async function generateExportZip(
  periodStart: string,
  periodEnd: string,
): Promise<{ buffer: Buffer<ArrayBufferLike>; errors?: string[] }> {
  const config = await getSiigoConfig();

  // Validate before generating siigo file
  const validation = await validateSiigoExport(periodStart, periodEnd, config);
  if (!validation.valid) {
    return { buffer: Buffer.alloc(0), errors: validation.errors };
  }

  const [siigoWb, summaryWb] = await Promise.all([
    generateSiigoExcel(periodStart, periodEnd, config),
    generateSummaryExcel(periodStart, periodEnd),
  ]);

  const siigoBuffer = Buffer.from(await siigoWb.xlsx.writeBuffer());
  const summaryBuffer = Buffer.from(await summaryWb.xlsx.writeBuffer());

  return new Promise((resolve, reject) => {
    const chunks: Buffer<ArrayBufferLike>[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("data", (chunk: Buffer<ArrayBufferLike>) => chunks.push(chunk));
    archive.on("end", () => resolve({ buffer: Buffer.concat(chunks) }));
    archive.on("error", reject);

    archive.append(Readable.from(siigoBuffer), {
      name: `novedades_siigo_${periodStart}_${periodEnd}.xlsx`,
    });
    archive.append(Readable.from(summaryBuffer), {
      name: `resumen_nomina_${periodStart}_${periodEnd}.xlsx`,
    });

    archive.finalize();
  });
}
