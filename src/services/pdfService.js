// src/services/pdfService.js
//
// Fecha a lacuna "documentos existem como texto estruturado, falta
// renderizar como PDF" (ver plano mestre e README). Não reimplementa nada
// do conteúdo — documentsService e clinicalDocumentsService continuam
// sendo a fonte de verdade dos dados; este service só desenha o que já
// existe. Usa pdf-lib (JS puro, roda no mesmo processo Node, sem precisar
// de um sidecar Python) — ver /mnt/skills/public/pdf/REFERENCE.md.
//
// Layout é deliberadamente simples (texto + linhas), não um design
// sofisticado — o objetivo aqui é ter um PDF correto e legível a partir de
// qualquer documento do sistema, não uma peça de design gráfico.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

class PdfBuilder {
  constructor(doc, fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(neededHeight) {
    if (this.y - neededHeight < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  // Quebra de linha manual — pdf-lib não faz wrap automático.
  wrapText(text, font, size, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  title(text, size = 16) {
    this.ensureSpace(size + 10);
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font: this.fonts.bold, color: rgb(0.1, 0.1, 0.1) });
    this.y -= size + 10;
  }

  heading(text, size = 12) {
    this.ensureSpace(size + 8);
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font: this.fonts.bold });
    this.y -= size + 8;
  }

  paragraph(text, size = 10, lineHeight = 14) {
    if (!text) return;
    const lines = this.wrapText(text, this.fonts.regular, size, CONTENT_WIDTH);
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font: this.fonts.regular });
      this.y -= lineHeight;
    }
  }

  bulletList(items, size = 10, lineHeight = 14) {
    for (const item of items) {
      const lines = this.wrapText(item, this.fonts.regular, size, CONTENT_WIDTH - 14);
      lines.forEach((line, i) => {
        this.ensureSpace(lineHeight);
        const prefix = i === 0 ? '• ' : '  ';
        this.page.drawText(prefix + line, { x: MARGIN, y: this.y, size, font: this.fonts.regular });
        this.y -= lineHeight;
      });
    }
  }

  spacer(amount = 10) {
    this.y -= amount;
  }

  line() {
    this.ensureSpace(10);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    this.y -= 14;
  }

  keyValue(label, value, size = 10, lineHeight = 14) {
    this.ensureSpace(lineHeight);
    this.page.drawText(`${label}: `, { x: MARGIN, y: this.y, size, font: this.fonts.bold });
    const labelWidth = this.fonts.bold.widthOfTextAtSize(`${label}: `, size);
    this.page.drawText(String(value ?? '—'), { x: MARGIN + labelWidth, y: this.y, size, font: this.fonts.regular });
    this.y -= lineHeight;
  }
}

async function createBuilder() {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  return { doc, builder: new PdfBuilder(doc, fonts) };
}

function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('pt-BR');
}

// ---------------------------------------------------------------------------
// Documento genérico (contratos, termos) — documentsService
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = {
  termo_paciente: 'Termo de Consentimento',
  contrato_paciente: 'Contrato de Prestação de Serviços',
  contrato_profissional: 'Contrato de Profissional',
  contrato_laboratorio: 'Contrato de Laboratório',
  contrato_fornecedor: 'Contrato de Fornecedor',
};

/**
 * Gera o PDF de um documento genérico (contrato/termo) com seu conteúdo e
 * o bloco de assinaturas — cada signatário aparece com status, método e
 * data, exatamente como registrado por documentsService.recordSignature.
 */
async function generateDocumentPdf({ document, signatures, clinicName, patientName, professionalName, supplierName }) {
  const { doc, builder } = await createBuilder();

  builder.title(CATEGORY_LABELS[document.category] || document.category);
  if (clinicName) builder.paragraph(clinicName, 10);
  builder.spacer(6);

  if (document.document_number) builder.keyValue('Número', document.document_number);
  builder.keyValue('Status', document.status);
  if (patientName) builder.keyValue('Paciente', patientName);
  if (professionalName) builder.keyValue('Profissional', professionalName);
  if (supplierName) builder.keyValue('Parte', supplierName);
  builder.keyValue('Emitido em', formatDate(document.created_at));
  if (document.valid_from || document.valid_until) {
    builder.keyValue('Vigência', `${formatDate(document.valid_from)} a ${formatDate(document.valid_until)}`);
  }
  builder.spacer(10);
  builder.line();

  builder.heading('Conteúdo');
  builder.paragraph(document.content);
  builder.spacer(16);

  builder.line();
  builder.heading('Assinaturas');
  builder.spacer(4);
  for (const sig of signatures || []) {
    const statusLabel = sig.status === 'assinado' ? 'ASSINADO' : sig.status === 'recusado' ? 'RECUSADO' : 'PENDENTE';
    builder.paragraph(`${sig.signer_name} (${sig.signer_role}) — ${statusLabel}`, 10);
    if (sig.status === 'assinado') {
      builder.paragraph(`  Assinado em ${formatDate(sig.signed_at)} · método: ${sig.signature_method || '—'} · código de validação: ${sig.validation_code || '—'}`, 9);
    }
    builder.spacer(4);
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Documentos clínicos (receitas, atestados) — clinicalDocumentsService
// ---------------------------------------------------------------------------

const CLINICAL_DOCUMENT_TITLES = {
  receita_simples: 'Receituário',
  receita_controle_especial: 'Receituário de Controle Especial',
  atestado: 'Atestado',
  declaracao_comparecimento: 'Declaração de Comparecimento',
  solicitacao_exame: 'Solicitação de Exame',
  encaminhamento: 'Encaminhamento',
  relatorio_clinico: 'Relatório Clínico',
};

function renderClinicalContent(builder, documentType, content) {
  switch (documentType) {
    case 'receita_simples':
    case 'receita_controle_especial':
      builder.heading('Medicamentos prescritos');
      builder.bulletList((content.medications || []).map((m) => `${m.name} — ${m.dosage}${m.instructions ? ` — ${m.instructions}` : ''}`));
      break;
    case 'atestado':
      builder.paragraph(`Atesto, para os devidos fins, que o(a) paciente esteve sob cuidados odontológicos, necessitando de afastamento de suas atividades por ${content.daysOff} dia(s).`);
      if (content.reason) builder.paragraph(`Motivo: ${content.reason}`);
      if (content.cid) builder.keyValue('CID', content.cid);
      break;
    case 'declaracao_comparecimento':
      builder.paragraph(`Declaro, para os devidos fins, que o(a) paciente compareceu a esta clínica em ${formatDate(content.attendanceDate)}${content.period ? `, no período ${content.period}` : ''}.`);
      break;
    case 'solicitacao_exame':
      builder.heading('Exames solicitados');
      builder.bulletList(content.examsRequested || []);
      if (content.clinicalIndication) builder.paragraph(`Indicação clínica: ${content.clinicalIndication}`);
      break;
    case 'encaminhamento':
      builder.paragraph(`Encaminho o(a) paciente para avaliação em ${content.destinationSpecialty}.`);
      if (content.reason) builder.paragraph(`Motivo: ${content.reason}`);
      break;
    case 'relatorio_clinico':
      builder.paragraph(content.text);
      break;
    default:
      builder.paragraph(JSON.stringify(content));
  }
}

/** Gera o PDF de uma receita/atestado/encaminhamento etc. a partir do documento clínico já emitido. */
async function generateClinicalDocumentPdf({ clinicalDocument, clinicName, patientName, professionalName }) {
  const { doc, builder } = await createBuilder();
  const content = typeof clinicalDocument.content === 'string' ? JSON.parse(clinicalDocument.content) : clinicalDocument.content;

  builder.title(CLINICAL_DOCUMENT_TITLES[clinicalDocument.document_type] || clinicalDocument.document_type);
  if (clinicName) builder.paragraph(clinicName, 10);
  builder.spacer(6);

  if (patientName) builder.keyValue('Paciente', patientName);
  if (professionalName) builder.keyValue('Profissional', professionalName);
  builder.keyValue('Emitido em', formatDate(clinicalDocument.issued_at));
  builder.keyValue('Status', clinicalDocument.status === 'cancelado' ? 'CANCELADO' : 'Válido');
  if (clinicalDocument.status === 'cancelado') {
    builder.paragraph(`Cancelado em ${formatDate(clinicalDocument.cancelled_at)} — motivo: ${clinicalDocument.cancelled_reason}`, 9);
  }
  builder.spacer(10);
  builder.line();

  renderClinicalContent(builder, clinicalDocument.document_type, content);

  builder.spacer(30);
  builder.line();
  builder.paragraph('Assinatura do profissional: ____________________________________', 10);

  return doc.save();
}

module.exports = { generateDocumentPdf, generateClinicalDocumentPdf, CATEGORY_LABELS, CLINICAL_DOCUMENT_TITLES };
