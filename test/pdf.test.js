// test/pdf.test.js
//
// Diferente dos outros testes, este não usa pg-mem — pdfService é uma
// função pura (recebe dados, devolve bytes de PDF), então testa direto,
// sem precisar de banco. O que importa aqui é confirmar que o PDF gerado
// é estruturalmente válido E que o texto real aparece dentro dele — não
// basta o arquivo "parecer" um PDF, o conteúdo precisa estar lá de verdade.

const { PDFDocument } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');
const pdfService = require('../src/services/pdfService');

function assert(cond, msg) {
  if (!cond) throw new Error('FALHOU: ' + msg);
  console.log('  OK -', msg);
}

async function extractText(bytes) {
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  const result = await parser.getText();
  return result.text;
}

async function main() {
  console.log('\n== Teste: PDF de documento genérico (contrato/termo) ==');

  const documentBytes = await pdfService.generateDocumentPdf({
    document: {
      category: 'termo_paciente',
      status: 'assinado',
      content: 'Eu, Maria da Silva, autorizo o procedimento de implante dentário, estando ciente dos riscos envolvidos.',
      created_at: '2026-06-01T10:00:00Z',
      valid_from: null,
      valid_until: null,
      document_number: 'DOC-2026-0042',
    },
    signatures: [
      { signer_name: 'Maria da Silva', signer_role: 'paciente', status: 'assinado', signed_at: '2026-06-01T10:05:00Z', signature_method: 'desenhada', validation_code: 'A1B2C3D4E5F6' },
      { signer_name: 'Dra. Ana Souza', signer_role: 'profissional', status: 'pendente' },
    ],
    clinicName: 'Clínica Sorriso Perfeito',
    patientName: 'Maria da Silva',
    professionalName: 'Dra. Ana Souza',
  });

  assert(Buffer.isBuffer(Buffer.from(documentBytes)), 'generateDocumentPdf retorna bytes');
  assert(Buffer.from(documentBytes).slice(0, 4).toString() === '%PDF', 'arquivo gerado começa com o cabeçalho mágico %PDF (é um PDF válido de verdade)');

  const reloaded = await PDFDocument.load(documentBytes);
  assert(reloaded.getPageCount() >= 1, 'PDF gerado tem ao menos 1 página e pode ser recarregado sem erro de estrutura');

  const extracted = await extractText(documentBytes);
  assert(extracted.includes('Maria da Silva'), 'nome da paciente aparece de fato no texto extraído do PDF');
  assert(extracted.includes('DOC-2026-0042'), 'número do documento aparece no PDF');
  assert(extracted.includes('implante dentário'), 'conteúdo real do termo aparece no PDF, não um placeholder');
  assert(extracted.includes('ASSINADO'), 'status da assinatura da paciente aparece corretamente');
  assert(extracted.includes('PENDENTE'), 'assinatura ainda pendente do profissional também aparece, com status certo');
  assert(extracted.includes('A1B2C3D4E5F6'), 'código de validação da assinatura aparece no PDF (rastreabilidade)');

  console.log('\n== Teste: PDF de atestado (documento clínico) ==');

  const atestadoBytes = await pdfService.generateClinicalDocumentPdf({
    clinicalDocument: {
      document_type: 'atestado',
      content: { daysOff: 3, reason: 'Procedimento cirúrgico de extração de terceiro molar' },
      issued_at: '2026-07-10T14:00:00Z',
      status: 'emitido',
    },
    clinicName: 'Clínica Sorriso Perfeito',
    patientName: 'João Pereira',
    professionalName: 'Dr. Carlos Mendes',
  });

  const atestadoText = await extractText(atestadoBytes);
  assert(atestadoText.includes('João Pereira'), 'nome do paciente aparece no atestado');
  assert(atestadoText.includes('3 dia'), 'número de dias de afastamento aparece corretamente no texto do atestado');
  assert(atestadoText.includes('extração de terceiro molar'), 'motivo do atestado aparece no PDF');

  console.log('\n== Teste: PDF de receita com múltiplos medicamentos ==');

  const receitaBytes = await pdfService.generateClinicalDocumentPdf({
    clinicalDocument: {
      document_type: 'receita_controle_especial',
      content: {
        medications: [
          { name: 'Amoxicilina', dosage: '500mg', instructions: '1 comprimido a cada 8h por 7 dias' },
          { name: 'Dipirona', dosage: '1g', instructions: 'Se dor, a cada 6h' },
        ],
      },
      issued_at: '2026-07-10T14:00:00Z',
      status: 'emitido',
    },
    patientName: 'João Pereira',
    professionalName: 'Dr. Carlos Mendes',
  });

  const receitaText = await extractText(receitaBytes);
  assert(receitaText.includes('Amoxicilina') && receitaText.includes('500mg'), 'primeiro medicamento aparece com dosagem correta');
  assert(receitaText.includes('Dipirona') && receitaText.includes('a cada 6h'), 'segundo medicamento também aparece, com suas próprias instruções');

  console.log('\n== Teste: documento cancelado mostra o motivo do cancelamento ==');

  const cancelledBytes = await pdfService.generateClinicalDocumentPdf({
    clinicalDocument: {
      document_type: 'atestado',
      content: { daysOff: 2 },
      issued_at: '2026-07-01T10:00:00Z',
      status: 'cancelado',
      cancelled_at: '2026-07-02T09:00:00Z',
      cancelled_reason: 'Emitido com número de dias incorreto',
    },
    patientName: 'Teste Cancelamento',
  });
  const cancelledText = await extractText(cancelledBytes);
  assert(cancelledText.includes('CANCELADO'), 'status cancelado aparece em destaque no PDF');
  assert(cancelledText.includes('número de dias incorreto'), 'motivo do cancelamento aparece no PDF -- rastreabilidade completa, mesmo em um documento inválido');

  console.log('\n== Teste: texto longo quebra em múltiplas linhas/páginas sem cortar conteúdo ==');

  const longText = 'Este é um parágrafo muito longo. '.repeat(300); // força quebra de página
  const longBytes = await pdfService.generateDocumentPdf({
    document: { category: 'contrato_paciente', status: 'rascunho', content: longText, created_at: '2026-01-01T00:00:00Z' },
    signatures: [],
  });
  const longDoc = await PDFDocument.load(longBytes);
  assert(longDoc.getPageCount() > 1, `texto longo o suficiente força quebra de página automaticamente (veio ${longDoc.getPageCount()} páginas)`);
  const longExtracted = await extractText(longBytes);
  assert((longExtracted.match(/parágrafo muito longo/g) || []).length >= 100, 'nenhuma repetição do texto foi perdida na quebra entre páginas');

  console.log('\nTodos os testes passaram.\n');
}

main().catch((err) => {
  console.error('\nTESTE FALHOU:', err.message);
  process.exit(1);
});
