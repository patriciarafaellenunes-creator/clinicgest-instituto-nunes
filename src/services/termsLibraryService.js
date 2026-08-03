// src/services/termsLibraryService.js
//
// Biblioteca configurável de termos por procedimento/especialidade (seção 3
// do documento 3). Em vez de cada clínica escrever do zero os termos de
// consentimento, este catálogo padrão cobre os tipos mais comuns do
// briefing, já estruturados com riscos, benefícios, alternativas e
// cuidados — a clínica pode editar depois, mas começa com uma base pronta.
//
// Este service não reimplementa nada do documentsService: seedStandardTerms
// só chama createTemplate várias vezes, e instantiateDocumentFromTemplate só
// monta o texto final e chama createDocument. A lógica de assinatura,
// travamento e revisão continua inteiramente em documentsService.

const documentsService = require('./documentsService');

class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.code = code;
  }
}

const STANDARD_TERMS_CATALOG = [
  {
    name: 'Consentimento para Extração Dentária',
    specialty: 'cirurgia_bucomaxilofacial',
    bodyTemplate: 'Eu, {{paciente}}, sob orientação do(a) profissional {{profissional}}, declaro estar ciente do procedimento de extração dentária a ser realizado.',
    clinicalContent: {
      risks: ['Sangramento', 'Infecção', 'Dor pós-operatória', 'Lesão a dentes ou estruturas vizinhas', 'Parestesia temporária ou permanente em casos específicos'],
      benefits: ['Eliminação de foco infeccioso ou dente inviável', 'Alívio de dor', 'Preparação para reabilitação futura'],
      alternatives: ['Tratamento endodôntico, quando clinicamente viável', 'Acompanhamento sem extração, quando aplicável'],
      precautionsBefore: ['Informar uso de medicamentos e condições de saúde preexistentes'],
      precautionsAfter: ['Repouso nas primeiras 24h', 'Evitar bochechos vigorosos e uso de canudo', 'Seguir prescrição medicamentosa'],
      contraindications: ['Avaliação médica prévia em pacientes com condições sistêmicas descompensadas'],
    },
  },
  {
    name: 'Consentimento para Cirurgia Odontológica',
    specialty: 'cirurgia_bucomaxilofacial',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a realizar o procedimento cirúrgico odontológico indicado, estando ciente dos riscos e benefícios explicados.',
    clinicalContent: {
      risks: ['Edema e equimose', 'Infecção', 'Sangramento', 'Necessidade de retorno para ajustes'],
      benefits: ['Correção do problema clínico identificado', 'Prevenção de agravamento do quadro'],
      alternatives: ['Tratamento conservador, quando aplicável'],
      precautionsBefore: ['Jejum quando indicado', 'Acompanhante no dia do procedimento'],
      precautionsAfter: ['Repouso', 'Dieta pastosa/fria nas primeiras 48h', 'Retorno para remoção de pontos, se aplicável'],
      contraindications: [],
    },
  },
  {
    name: 'Consentimento para Implante Dentário',
    specialty: 'implantodontia',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a realizar a instalação de implante(s) dentário(s), estando ciente das etapas, riscos e prazos envolvidos.',
    clinicalContent: {
      risks: ['Falha de osseointegração', 'Infecção', 'Lesão a estruturas anatômicas adjacentes', 'Necessidade de enxerto complementar'],
      benefits: ['Reabilitação funcional e estética', 'Preservação óssea'],
      alternatives: ['Prótese removível', 'Prótese fixa convencional sobre dentes'],
      precautionsBefore: ['Avaliação tomográfica prévia'],
      precautionsAfter: ['Higiene específica na região', 'Retornos periódicos de manutenção'],
      contraindications: ['Doenças sistêmicas descompensadas', 'Tabagismo pode reduzir taxa de sucesso'],
    },
  },
  {
    name: 'Consentimento para Enxerto Ósseo',
    specialty: 'implantodontia',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a realizar o procedimento de enxerto ósseo necessário ao plano de tratamento.',
    clinicalContent: {
      risks: ['Reabsorção parcial do enxerto', 'Infecção', 'Exposição da membrana/material'],
      benefits: ['Volume ósseo adequado para reabilitação futura'],
      alternatives: ['Técnicas alternativas de reabilitação sem enxerto, quando viáveis'],
      precautionsBefore: [],
      precautionsAfter: ['Evitar pressão na região', 'Seguir retorno para avaliação de integração'],
      contraindications: [],
    },
  },
  {
    name: 'Consentimento para Tratamento Endodôntico',
    specialty: 'endodontia',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a realizar o tratamento endodôntico (tratamento de canal) indicado.',
    clinicalContent: {
      risks: ['Fratura de instrumento', 'Necessidade de retratamento', 'Perfuração radicular (rara)'],
      benefits: ['Preservação do dente', 'Eliminação da infecção/dor'],
      alternatives: ['Extração do dente'],
      precautionsBefore: [],
      precautionsAfter: ['Evitar mastigar no dente até a restauração definitiva', 'Retorno para avaliação radiográfica'],
      contraindications: [],
    },
  },
  {
    name: 'Consentimento para Clareamento Dental',
    specialty: 'dentistica_estetica',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a realizar o procedimento de clareamento dental, estando ciente dos resultados esperados e limitações.',
    clinicalContent: {
      risks: ['Sensibilidade dentária temporária', 'Irritação gengival'],
      benefits: ['Melhora da cor dental'],
      alternatives: ['Facetas ou lentes de contato dental, quando aplicável'],
      precautionsBefore: ['Avaliação de restaurações e cáries prévias'],
      precautionsAfter: ['Evitar alimentos pigmentantes nas primeiras 48h'],
      contraindications: ['Gestação e lactação (clareamento com peróxido)'],
    },
  },
  {
    name: 'Consentimento para Facetas e Lentes de Contato Dental',
    specialty: 'dentistica_estetica',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a realizar o procedimento de facetas/lentes de contato dental, estando ciente do desgaste dental envolvido, quando aplicável, e da durabilidade esperada.',
    clinicalContent: {
      risks: ['Sensibilidade', 'Descolamento', 'Necessidade de ajuste oclusal'],
      benefits: ['Melhora estética do sorriso'],
      alternatives: ['Clareamento isolado', 'Coroas totais, quando indicado'],
      precautionsBefore: ['Planejamento digital do sorriso (mock-up)'],
      precautionsAfter: ['Evitar hábitos parafuncionais (roer unhas, morder objetos)', 'Uso de placa de proteção noturna, se indicado'],
      contraindications: [],
    },
  },
  {
    name: 'Consentimento para Ortodontia e Alinhadores',
    specialty: 'ortodontia',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a iniciar o tratamento ortodôntico, estando ciente do tempo estimado e da necessidade de colaboração com o uso dos dispositivos.',
    clinicalContent: {
      risks: ['Reabsorção radicular leve', 'Desconforto inicial', 'Resultado dependente da colaboração do paciente'],
      benefits: ['Alinhamento dentário', 'Melhora funcional e estética'],
      alternatives: ['Aparelho fixo convencional', 'Alinhadores removíveis'],
      precautionsBefore: [],
      precautionsAfter: ['Uso de contenção após o tratamento ativo'],
      contraindications: [],
    },
  },
  {
    name: 'Consentimento para Harmonização Orofacial / Toxina Botulínica',
    specialty: 'harmonizacao_orofacial',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a realizar o procedimento de harmonização orofacial indicado, estando ciente da duração do efeito e da necessidade de manutenção periódica.',
    clinicalContent: {
      risks: ['Equimose', 'Assimetria temporária', 'Reação ao produto'],
      benefits: ['Efeito estético conforme planejamento facial'],
      alternatives: ['Não realizar o procedimento'],
      precautionsBefore: ['Evitar anti-inflamatórios e anticoagulantes conforme orientação prévia'],
      precautionsAfter: ['Evitar deitar-se ou massagear a região nas primeiras horas', 'Evitar exercícios físicos intensos no mesmo dia'],
      contraindications: ['Gestação e lactação', 'Doenças neuromusculares (para toxina botulínica)'],
    },
  },
  {
    name: 'Consentimento para Tratamento Periodontal',
    specialty: 'periodontia',
    bodyTemplate: 'Eu, {{paciente}}, autorizo o(a) profissional {{profissional}} a realizar o tratamento periodontal indicado.',
    clinicalContent: {
      risks: ['Sensibilidade pós-operatória', 'Recessão gengival', 'Necessidade de manutenção contínua'],
      benefits: ['Controle da doença periodontal', 'Preservação dos dentes e do osso de suporte'],
      alternatives: ['Ausência de tratamento (com risco de progressão da doença)'],
      precautionsBefore: [],
      precautionsAfter: ['Manutenção periódica (retornos periodontais)', 'Reforço de técnica de higiene oral'],
      contraindications: [],
    },
  },
];

/** Semeia o catálogo padrão para uma clínica. Idempotente: não duplica modelos que já existem pelo nome. */
async function seedStandardTerms(client, { clinicId, userId }) {
  const { rows: existing } = await client.query(
    `SELECT name FROM document_templates WHERE clinic_id = $1 AND category = 'termo_paciente'`,
    [clinicId]
  );
  const existingNames = new Set(existing.map((r) => r.name));

  const created = [];
  for (const entry of STANDARD_TERMS_CATALOG) {
    if (existingNames.has(entry.name)) continue;
    const template = await documentsService.createTemplate(client, {
      clinicId, name: entry.name, category: 'termo_paciente', bodyTemplate: entry.bodyTemplate,
      requiredForSpecialty: entry.specialty, clinicalContent: entry.clinicalContent, userId,
    });
    created.push(template);
  }
  return created;
}

/** Monta o texto final do documento a partir do modelo, preenchendo placeholders e anexando as seções clínicas estruturadas. */
function buildContentFromTemplate(template, { patientName, professionalName }) {
  let body = template.body_template
    .replace(/\{\{paciente\}\}/g, patientName || '[nome do paciente]')
    .replace(/\{\{profissional\}\}/g, professionalName || '[nome do profissional]');

  const content = typeof template.clinical_content === 'string' ? JSON.parse(template.clinical_content) : template.clinical_content;
  if (content) {
    const section = (title, items) => (items && items.length > 0 ? `\n\n${title}:\n- ${items.join('\n- ')}` : '');
    body += section('Riscos e limitações', content.risks);
    body += section('Benefícios esperados', content.benefits);
    body += section('Alternativas de tratamento', content.alternatives);
    body += section('Cuidados antes do procedimento', content.precautionsBefore);
    body += section('Cuidados após o procedimento', content.precautionsAfter);
    body += section('Contraindicações', content.contraindications);
  }
  return body;
}

/** Cria um documento de verdade a partir de um modelo da biblioteca, com o texto já preenchido. */
async function instantiateDocumentFromTemplate(client, {
  templateId, clinicId, unitId, patientId, professionalId, patientName, professionalName,
  relatedProcedureId, relatedTreatmentPlanId, relatedBudgetId, signers, userId,
}) {
  const { rows } = await client.query(`SELECT * FROM document_templates WHERE id = $1 AND clinic_id = $2`, [templateId, clinicId]);
  const template = rows[0];
  if (!template) throw new DomainError('Modelo de documento não encontrado.', 'TEMPLATE_NOT_FOUND');

  const content = buildContentFromTemplate(template, { patientName, professionalName });

  return documentsService.createDocument(client, {
    clinicId, unitId, templateId: template.id, category: template.category, partyType: 'patient',
    patientId, professionalId, relatedProcedureId, relatedTreatmentPlanId, relatedBudgetId,
    content, signers: signers || [{ signerName: patientName, signerRole: 'paciente' }, { signerName: professionalName, signerRole: 'profissional' }],
    userId,
  });
}

module.exports = { DomainError, STANDARD_TERMS_CATALOG, seedStandardTerms, buildContentFromTemplate, instantiateDocumentFromTemplate };
