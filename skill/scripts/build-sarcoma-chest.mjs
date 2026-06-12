#!/usr/bin/env node
/**
 * Build script: Sarcoma of the Chest — pure-medicine chiron lesson.
 *
 * Drives the REAL compiled widget emitters from ../dist/lib/:
 *   - renderMcqClinicalVignette (4 clinical vignettes)
 *   - renderAgreementMatrix (1 always/sometimes/never reasoning matrix)
 *   - emitSrDeck + emitSrCardCss (SR flashcard deck, 8 cards)
 *
 * Output: ~/Documents/generated/chiron-sarcoma-of-the-chest/lesson.html
 *
 * Content grounded in:
 *   Harrison's 22e ch96 (Soft-Tissue & Bone Sarcomas), ch282 (Cardiac Tumors),
 *   ch83 (Neoplasms of the Lung) + Gemini grounded research on PPS / PAIS /
 *   chest-wall sarcomas / mediastinal sarcomas.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderMcqClinicalVignette, renderAgreementMatrix } from '../dist/lib/widget-renderer.js';
import { emitSrDeck, emitSrCardCss } from '../dist/lib/widgets/sr-card.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(process.env.HOME, 'Documents', 'generated', 'chiron-sarcoma-of-the-chest');
const OUT = resolve(OUT_DIR, 'lesson.html');

mkdirSync(OUT_DIR, { recursive: true });

// ============================================================================
// CONTENT
// ============================================================================

// ---------------------------------------------------------------------------
// Vignette 1 — PAIS mimicking unresolving chronic PE
// ---------------------------------------------------------------------------
const vignette1 = renderMcqClinicalVignette({
  type: 'mcq-clinical-vignette',
  vignetteCategory: 'mimicker',
  vignette:
    'A 48-year-old woman presents with a 4-month history of progressive exertional dyspnea, ' +
    'mild haemoptysis, and right-sided pleuritic chest pain. Six months ago she was diagnosed ' +
    'with "chronic thromboembolic disease" and started on warfarin (therapeutic INR). Despite ' +
    'adequate anticoagulation her symptoms have worsened. CT pulmonary angiography shows a ' +
    'large intraluminal filling defect in the right main pulmonary artery with heterogeneous ' +
    'enhancement, arterial expansion, and a subtle peripheral enhancing rim ("Wall Eclipse Sign"). ' +
    'V/Q scan shows matched perfusion defects. PET/CT demonstrates intense FDG uptake ' +
    '(SUVmax 8.2) throughout the filling defect. MRI shows heterogeneous T1/T2 signal with ' +
    'gadolinium enhancement — features that would not be expected for bland thrombus.',
  keyInfo: ['Age 48F', 'Progressive dyspnea × 4 months', 'INR therapeutic × 6 months — no improvement',
    'CT: Wall Eclipse Sign + arterial expansion', 'PET SUVmax 8.2', 'MRI: gadolinium enhancement'],
  stem: 'Which single investigation result is MOST pathognomonic for the correct diagnosis?',
  options: [
    {
      label: 'FDG-PET SUVmax > 5 in a pulmonary arterial filling defect',
      correct: false,
      explanation: 'High FDG uptake distinguishes PAIS from bland thrombus and supports the diagnosis, but SUVmax > 5 is not specific — organizing thrombus and vasculitis can also be FDG-avid. Useful supporting evidence, not pathognomonic.',
    },
    {
      label: 'Wall Eclipse Sign on CTPA (peripheral enhancing rim with central low attenuation)',
      correct: false,
      explanation: 'The Wall Eclipse Sign is characteristic of pulmonary artery intimal sarcoma (PAIS) and distinguishes it from thrombus (which does not enhance). It is the most specific CT finding, but the question asks for the most pathognomonic single result — molecular confirmation is the gold standard.',
    },
    {
      label: 'MDM2 gene amplification on 12q13-15 detected by FISH on biopsy material',
      correct: true,
      explanation: 'MDM2 amplification (chromosome 12q13-15) is the hallmark molecular finding in pulmonary artery intimal sarcoma. Its presence in an intraluminal lesion is pathognomonic. No other pulmonary vascular entity shares this molecular signature. The Wall Eclipse Sign and FDG-avidity are highly suggestive, but MDM2 FISH is the definitive diagnostic confirmation.',
    },
    {
      label: 'Elevated D-dimer (> 10× ULN)',
      correct: false,
      explanation: 'D-dimer is neither sensitive nor specific for PAIS. It is elevated in many inflammatory and thrombotic conditions and cannot distinguish sarcoma from thrombus. This result adds no diagnostic value in this clinical context.',
    },
    {
      label: 'Right heart catheterisation demonstrating pulmonary hypertension (mPAP > 25 mmHg)',
      correct: false,
      explanation: 'Pulmonary hypertension may develop secondary to PAIS as the tumour occludes the arterial lumen — just as it does in CTEPH. This finding supports haemodynamic compromise but does not establish the diagnosis; it is shared by many other causes of large vessel pulmonary obstruction.',
    },
  ],
  hammer: 4,
  attendingTip:
    'When a "PE" fails to resolve on therapeutic anticoagulation, NEVER call it chronic ' +
    'CTEPH without histology. PAIS is the great impostor: it grows intraluminally, mimics ' +
    'clot on V/Q, and is uniformly fatal without surgical resection. The Wall Eclipse Sign ' +
    '(enhancing rim = viable tumour) + MDM2 FISH is the diagnostic dyad. Refer immediately ' +
    'to a high-volume sarcoma centre for pulmonary endarterectomy / sleeve resection. ' +
    'Median survival without surgery is < 18 months.',
  variants: [],
});

// ---------------------------------------------------------------------------
// Vignette 2 — Primary pulmonary synovial sarcoma in a young non-smoker
// ---------------------------------------------------------------------------
const vignette2 = renderMcqClinicalVignette({
  type: 'mcq-clinical-vignette',
  vignetteCategory: 'atypical',
  vignette:
    'A 27-year-old non-smoker (0 pack-years) presents with a 3-month history of dry cough and ' +
    'mild dyspnoea. He has no constitutional symptoms, no haemoptysis, and no family history of ' +
    'cancer. Chest CT shows a 9.4 cm well-circumscribed, heterogeneous, PERIPHERAL left lower ' +
    'lobe mass. There are no satellite nodules, no hilar or mediastinal lymphadenopathy, and no ' +
    'spiculation or pleural tethering. PET/CT shows intense FDG uptake (SUVmax 12.1) with no ' +
    'other sites of disease. CT-guided core needle biopsy shows spindle-cell morphology; ' +
    'IHC demonstrates focal keratin and EMA positivity alongside strong vimentin. ' +
    'FISH confirms SS18-SSX1 (SYT-SSX1) fusion.',
  keyInfo: ['Age 27M, 0 pack-years', '9.4 cm peripheral LLL mass', 'No LN disease; no spiculation',
    'IHC: vimentin+, focal keratin/EMA+', 'SS18-SSX1 fusion confirmed by FISH'],
  stem: 'Which statement about the correct diagnosis and management is MOST accurate?',
  options: [
    {
      label: 'The most important initial step is to exclude an extrapulmonary primary sarcoma with metastasis to the lung',
      correct: true,
      explanation: 'Primary pulmonary sarcoma (PPS) is rare (<0.5% of primary lung tumours). Sarcomas metastasize TO the lung far more often than they arise there. Before diagnosing PPS, full staging must exclude a primary at another site. With confirmed SS18-SSX1 fusion and no extrapulmonary disease, PPS — specifically primary pulmonary synovial sarcoma — is the diagnosis. The SS18-SSX (SYT-SSX) fusion is pathognomonic for synovial sarcoma regardless of site.',
    },
    {
      label: 'The negative smoking history makes primary lung adenocarcinoma the most likely diagnosis',
      correct: false,
      explanation: 'Lung carcinoma is overwhelmingly the most common lung malignancy overall, but sarcoma should be suspected when the mass is unusually large (> 5–10 cm), peripheral, well-circumscribed without spiculation, and lacks hilar adenopathy — especially in a young non-smoker. The IHC (focal keratin/EMA with vimentin dominant) and SS18-SSX1 fusion confirm sarcoma, not carcinoma.',
    },
    {
      label: 'Palliative chemotherapy (gemcitabine/docetaxel) is the treatment of choice given the size > 9 cm',
      correct: false,
      explanation: 'For primary pulmonary sarcoma, complete R0 surgical resection (lobectomy or pneumonectomy) is the cornerstone of treatment and the single most important prognostic factor — regardless of size. Palliative chemotherapy is reserved for unresectable or metastatic disease. This patient has no metastases; surgical resection with curative intent should be pursued, with adjuvant chemotherapy/RT considered for high-grade/large tumours.',
    },
    {
      label: 'SS18-SSX1 fusion is specific to sarcomas arising in the synovial membrane only',
      correct: false,
      explanation: 'A common misconception. Synovial sarcoma is a misnomer — it does NOT arise from synovial tissue. The t(X;18)(p11;q11) translocation producing SS18-SSX (SYT-SSX) fusion can occur in soft tissue, lung, pleura, kidney, and other sites. The fusion is pathognomonic for synovial sarcoma as a histological entity, irrespective of anatomical origin.',
    },
    {
      label: 'The FDG-avidity confirms metastatic disease to the lung from an occult extrapulmonary sarcoma',
      correct: false,
      explanation: 'High FDG uptake (SUVmax 12.1) reflects metabolic activity of this sarcoma — it is consistent with primary pulmonary sarcoma. FDG-avidity alone does not establish site of origin. The full-body PET/CT showing no other sites of disease supports a primary pulmonary lesion, not metastatic disease. All sarcomas are metabolically active on PET.',
    },
  ],
  hammer: 4,
  attendingTip:
    'In a young non-smoker with a large, round, peripheral, FDG-avid lung mass lacking hilar nodes ' +
    'and spiculation — think SARCOMA. The big three subtypes of primary pulmonary sarcoma are ' +
    'synovial sarcoma (SS18-SSX by FISH), leiomyosarcoma, and undifferentiated pleomorphic sarcoma. ' +
    'Always exclude a primary elsewhere first: full PET staging is mandatory. If truly primary, ' +
    'refer to a sarcoma centre for R0 resection + multidisciplinary planning. 5-year OS is ~50% ' +
    'with R0; it drops to < 20% without.',
  variants: [],
});

// ---------------------------------------------------------------------------
// Vignette 3 — Chest-wall chondrosarcoma
// ---------------------------------------------------------------------------
const vignette3 = renderMcqClinicalVignette({
  type: 'mcq-clinical-vignette',
  vignetteCategory: 'classic',
  vignette:
    'A 55-year-old man presents with a 6-month history of a slowly enlarging, mildly tender ' +
    'mass over his right anterior chest wall at the level of the 5th rib. He describes it as ' +
    '"bony hard." Chest radiograph shows an expansile lesion of the right 5th rib with ' +
    'stippled calcification ("rings and arcs" pattern). CT confirms a 7.2 cm lobular rib ' +
    'lesion with chondroid matrix, endosteal scalloping, and a soft-tissue component. ' +
    'There is no pleural effusion, no parenchymal invasion, and no lymphadenopathy. ' +
    'Bone scan shows increased uptake at the lesion. Core biopsy reveals grade II chondrosarcoma.',
  keyInfo: ['Age 55M', '7.2 cm right 5th rib, bony-hard', 'CT: chondroid matrix, endosteal scalloping',
    'Biopsy: grade II chondrosarcoma', 'No metastasis on staging'],
  stem: 'Which statement about the surgical strategy for this patient is MOST accurate?',
  options: [
    {
      label: 'Wide en-bloc resection with 2–4 cm bony margins is required; chondrosarcoma is resistant to chemotherapy and radiotherapy',
      correct: true,
      explanation: 'Chondrosarcoma is the most common primary malignant chest-wall tumour. It is inherently chemotherapy- and radiotherapy-resistant; complete wide surgical excision with 2–4 cm margins is the only potentially curative approach. The resected segment requires chest-wall reconstruction (prosthetic mesh ± PMMA + muscle flap). Grade II disease carries a significant recurrence risk with narrow margins; R0 is the goal. Inadequate margins are the primary cause of local recurrence.',
    },
    {
      label: 'Neoadjuvant doxorubicin/ifosfamide should be given first to downsize the tumour before resection',
      correct: false,
      explanation: 'Chondrosarcoma is one of the most chemotherapy-resistant mesenchymal tumours. Standard soft-tissue sarcoma regimens (doxorubicin/ifosfamide) have very limited activity. Neoadjuvant chemotherapy is not the standard of care for localised chondrosarcoma; upfront wide surgical resection remains the primary approach.',
    },
    {
      label: 'Marginal excision (periosteal shell) is adequate for grade II chondrosarcoma to preserve chest-wall integrity',
      correct: false,
      explanation: 'Marginal excision is associated with high local recurrence rates in chondrosarcoma, even for grade I lesions. The widely held surgical standard is 2–4 cm clear margins with en-bloc rib resection. Chest-wall integrity is restored by reconstruction, not by accepting inadequate margins.',
    },
    {
      label: 'Radiation therapy as primary treatment is appropriate given the proximity to the lung',
      correct: false,
      explanation: 'Radiation therapy has low efficacy against conventional chondrosarcoma (grade I–II). It may be considered as a palliative or adjuvant measure in unresectable or recurrent disease, but it is not an alternative to surgery for resectable lesions. The proximity to the lung is a surgical planning consideration, not a contraindication to excision.',
    },
    {
      label: 'Excisional biopsy at presentation is preferred because it establishes diagnosis and achieves resection simultaneously',
      correct: false,
      explanation: 'Excisional biopsy risks tumour contamination of the surgical field and inadequate margins. Core needle biopsy (CT-guided, through the lesion, not the soft-tissue component) is the preferred diagnostic approach. After histological confirmation, a planned wide resection with proper margins and reconstruction can be scheduled. Never perform excisional biopsy of a suspected primary bone sarcoma without prior planning for definitive resection.',
    },
  ],
  hammer: 3,
  attendingTip:
    'Remember the chest-wall sarcoma hierarchy: chondrosarcoma (adults, most common malignant), ' +
    'Ewing sarcoma/PNET (adolescents/young adults — highly chemosensitive, neoadjuvant FIRST), ' +
    'liposarcoma, fibrosarcoma. Chondrosarcoma is the outlier — it does NOT respond to chemo/RT. ' +
    'Wide margins (2–4 cm) = the only cure. After resection, reconstruct with synthetic mesh + ' +
    'titanium bars ± PMMA for rigid anterior defects. Failure to achieve R0 is the chief cause ' +
    'of local recurrence and cancer-specific death in this disease.',
  variants: [],
});

// ---------------------------------------------------------------------------
// Vignette 4 — "Sarcoma or carcinoma?" reasoning vignette
// ---------------------------------------------------------------------------
const vignette4 = renderMcqClinicalVignette({
  type: 'mcq-clinical-vignette',
  vignetteCategory: 'mimicker',
  vignette:
    'A 38-year-old woman with a 5 pack-year smoking history presents with a 2-month history of ' +
    'progressive dyspnoea. Chest CT shows a 12 cm, well-circumscribed, heterogeneous, peripheral ' +
    'right upper lobe mass with central necrosis. There is no spiculation, no satellite nodules, ' +
    'no hilar or mediastinal lymphadenopathy, and no pleural effusion. PET/CT shows intense ' +
    'FDG uptake (SUVmax 14) in the mass; full-body staging reveals no other sites of disease. ' +
    'Bronchoscopy is negative (peripheral lesion). CT-guided biopsy is planned.',
  keyInfo: ['Age 38F, 5 pack-years (light)', '12 cm peripheral RUL mass, heterogeneous, well-circumscribed',
    'No spiculation; no hilar LN; no satellite nodules', 'SUVmax 14 by PET', 'Full-body staging: no metastasis'],
  stem: 'Which combination of features BEST justifies including primary pulmonary sarcoma in the differential diagnosis before biopsy?',
  options: [
    {
      label: 'Young age + light smoking history + unusually large peripheral mass without spiculation or hilar adenopathy',
      correct: true,
      explanation: 'Lung carcinoma is overwhelmingly the most common lung malignancy, but sarcoma should be considered when: the patient is young, has weak or no smoking history, the mass is unusually large (> 5–10 cm) with heterogeneous/necrotic texture, it is peripheral and well-circumscribed (not spiculated), and there are no hilar or mediastinal lymph nodes (carcinoma commonly spreads to nodes; primary pulmonary sarcoma rarely does in early disease). This constellation — especially in a 38-year-old with only 5 pack-years — should always prompt sarcoma in the differential. Biopsy with IHC and molecular testing (SS18, MDM2 FISH, vimentin) will resolve it.',
    },
    {
      label: 'FDG-avidity alone (SUVmax > 10) is sufficient to distinguish sarcoma from carcinoma',
      correct: false,
      explanation: 'Both sarcomas and high-grade carcinomas (including squamous and large cell) can have high FDG avidity. SUVmax alone cannot distinguish histological type. The utility of PET in sarcoma evaluation is primarily for staging (detect metastases) and assessing treatment response — not for primary histological diagnosis.',
    },
    {
      label: 'The peripheral location and large size together predict squamous cell carcinoma and eliminate sarcoma from the differential',
      correct: false,
      explanation: 'Squamous cell carcinoma can be large and peripheral, but it is strongly associated with smoking (this patient has only 5 pack-years) and classically cavitates. Spiculation, pleural retraction, and lymphadenopathy are more typical of carcinoma. The absence of all these features in a 38-year-old with minimal smoking history keeps sarcoma in the differential.',
    },
    {
      label: 'Negative bronchoscopy confirms the mass is not a carcinoma',
      correct: false,
      explanation: 'Negative bronchoscopy simply reflects the peripheral location of the mass (beyond bronchoscopic reach). Both peripheral adenocarcinomas and sarcomas can be bronchoscopically negative. Bronchoscopy findings do not distinguish carcinoma from sarcoma — only histopathology with IHC and molecular testing can.',
    },
    {
      label: 'Central necrosis on CT is pathognomonic for sarcoma and excludes all other diagnoses',
      correct: false,
      explanation: 'Central necrosis reflects rapid growth outpacing blood supply. It occurs in high-grade sarcomas but also in large cell carcinoma, squamous cell carcinoma, lymphoma, and metastatic disease. It is a feature of high-grade biology — not a diagnosis. No single imaging finding is pathognomonic for sarcoma.',
    },
  ],
  hammer: 3,
  attendingTip:
    'The clinical sarcoma signal for a lung mass: YOUNG + MINIMAL SMOKE + LARGE (> 5 cm) + ' +
    'PERIPHERAL + WELL-CIRCUMSCRIBED + NO HILAR NODES. That pattern should always trigger ' +
    '"sarcoma rule-out" with IHC (vimentin, keratin, SMA, S100, CD34 depending on subtype) + ' +
    'FISH for SS18-SSX and MDM2. Do NOT reflexively call it NSCLC just because it is in the lung — ' +
    'misdiagnosis as carcinoma leads to the wrong chemotherapy (platinum doublets do not work), ' +
    'missing the correct regimen (ifosfamide/doxorubicin), and losing the window for R0 resection. ' +
    'Harrison\'s: > half of lung carcinomas present as advanced disease, but sarcomas at this stage ' +
    'may still be resectable with clear margins.',
  variants: [],
});

// ---------------------------------------------------------------------------
// Agreement Matrix — clinical reasoning rules
// ---------------------------------------------------------------------------
const agreementMatrix = renderAgreementMatrix({
  type: 'agreement-matrix',
  promptText: 'For each statement about thoracic sarcoma reasoning, classify it as ALWAYS, SOMETIMES, or NEVER true:',
  statements: [
    'A pulmonary artery filling defect that fails to resolve on therapeutic anticoagulation warrants evaluation for intimal sarcoma (PAIS)',
    'MDM2 amplification on chromosome 12q13-15 supports the diagnosis of pulmonary artery intimal sarcoma',
    'The SS18-SSX (SYT-SSX) fusion transcript is pathognomonic for synovial sarcoma regardless of anatomical site of origin',
    'Primary pulmonary sarcoma (de novo arising in the lung) is more common than sarcoma metastasising TO the lung',
    'R0 (complete, margin-negative) surgical resection is the single most important modifiable prognostic factor for thoracic sarcoma',
    'Chondrosarcoma of the chest wall responds well to standard doxorubicin-based chemotherapy',
    'Ewing sarcoma / PNET of the chest wall in young patients is highly chemosensitive and should receive neoadjuvant chemotherapy before surgery',
    'The Wall Eclipse Sign on CTPA (peripheral enhancing rim) can be caused by bland venous thrombus',
  ],
  classifications: ['always', 'always', 'always', 'never', 'always', 'never', 'always', 'never'],
  rationale: [
    'CTEPH (chronic thromboembolic pulmonary hypertension) is the default diagnosis for a non-resolving pulmonary obstruction on anticoagulation, but PAIS must be excluded. The clinical overlap is complete: both cause progressive dyspnoea, intraluminal filling defects, and V/Q mismatch. PAIS should be evaluated (CT + PET + MRI + biopsy) whenever thrombus does not shrink with adequate anticoagulation.',
    'MDM2 amplification on 12q13-15, detectable by FISH on biopsy material, is the hallmark of PAIS. No other pulmonary vascular or intraluminal tumour carries this amplification. It is not found in thrombus, CTEPH, angiosarcoma, or leiomyosarcoma. When present in an intraluminal pulmonary arterial lesion, it is pathognomonic.',
    'The t(X;18)(p11;q11) translocation producing SS18-SSX1 or SS18-SSX2 fusion defines synovial sarcoma as a histological entity. It is found in synovial sarcoma arising in the leg, lung, pleura, kidney, and other soft-tissue sites. The name "synovial" is a misnomer — these tumours do not arise from synovium. SS18-SSX positivity is pathognomonic for synovial sarcoma wherever it arises.',
    'Sarcomas are notorious for haematogenous spread to the lung — the lung is the most common site of sarcoma metastasis. Primary pulmonary sarcoma (de novo) is exceedingly rare, accounting for <0.5% of primary lung tumours. The maxim is: a spindle-cell tumour in the lung is metastatic sarcoma until proven otherwise. Full staging to exclude a primary elsewhere is mandatory before diagnosing primary pulmonary sarcoma.',
    'Across all sarcoma histotypes and sites, achievement of R0 (clear microscopically negative margins) is the single most important prognostic factor that is modifiable by the surgeon and treatment team. Stage, grade, and histotype influence prognosis, but R0 is the only variable the treating team controls. Harrison\'s (ch96) and graded per AJCC: stage-III patients managed at high-volume sarcoma centres achieve R0 more reliably than at general centres.',
    'Conventional chondrosarcoma (grades I–III) is one of the most chemotherapy-resistant mesenchymal tumours. Standard soft-tissue sarcoma regimens (doxorubicin, ifosfamide, gemcitabine/docetaxel) have very limited if any meaningful activity. This is the defining clinical feature that separates chondrosarcoma management from other chest-wall sarcomas. Surgery (wide excision, 2–4 cm margins) is the only curative modality.',
    'Ewing sarcoma/PNET is among the most chemosensitive sarcomas. Neoadjuvant multi-agent chemotherapy (VDC/IE: vincristine/doxorubicin/cyclophosphamide alternating with ifosfamide/etoposide) is standard BEFORE surgery, both to reduce tumour volume and to treat micrometastatic disease. This is the opposite management philosophy from chondrosarcoma — knowing the distinction is high-yield.',
    'Bland thrombus does not enhance. The Wall Eclipse Sign — a peripheral rim of enhancement around a central non-enhancing filling defect — specifically indicates viable, perfused tumour tissue at the periphery. Enhancement requires vascularity; thrombus has none. This sign, absent in CTEPH/bland thrombus, is PATHOGNOMONIC for intimal sarcoma (specifically PAIS) when seen in the pulmonary vasculature.',
  ],
  options: ['Always', 'Sometimes', 'Never'],
  variants: [],
});

// ---------------------------------------------------------------------------
// SR Deck — 8 medicine flashcards using idiom-card shape
//   {it: front text, meaning: back key fact, literal: optional source/tag}
// ---------------------------------------------------------------------------
const srCards = emitSrDeck({
  verbs: [],
  nouns: [],
  idioms: [
    {
      it: 'Primary Pulmonary Sarcoma (PPS) — rarity and subtypes',
      meaning: '< 0.5% of primary lung tumours. Main subtypes: synovial sarcoma (SS18-SSX fusion), leiomyosarcoma, undifferentiated pleomorphic sarcoma. Rule out extrapulmonary primary first — metastatic sarcoma to lung is far more common.',
      literal: 'Source: Gemini grounded research + Harrison\'s 22e ch96',
    },
    {
      it: 'SS18-SSX (SYT-SSX) fusion — what it means',
      meaning: 'Pathognomonic for synovial sarcoma (any site). t(X;18)(p11;q11). SS18-SSX1 most common. IHC: vimentin+, focal keratin/EMA. Synovial sarcoma does NOT arise from synovium — name is a misnomer.',
      literal: 'Source: Gemini grounded research',
    },
    {
      it: 'Pulmonary Artery Intimal Sarcoma (PAIS) — the PE impostor',
      meaning: 'Arises from arterial intima. Mimics CTEPH: progressive dyspnea + intraluminal filling defects. Wall Eclipse Sign (peripheral enhancement) + heterogeneous gadolinium on MRI + FDG-avidity distinguish it from bland thrombus. MDM2 amplification (12q13-15) is the molecular hallmark. Median survival < 18 months.',
      literal: 'Source: Gemini grounded research + Harrison\'s 22e ch282',
    },
    {
      it: 'Chondrosarcoma — most common primary malignant chest-wall tumour',
      meaning: 'Adults. Rings-and-arcs calcification. CHEMO- and RT-RESISTANT. Treatment = wide en-bloc excision with 2–4 cm bony margins + chest-wall reconstruction. R0 is the only cure. Contrast with Ewing/PNET (young, highly chemosensitive).',
      literal: 'Source: Gemini grounded research',
    },
    {
      it: 'FNCLCC grading system for soft-tissue sarcomas',
      meaning: '3 criteria: (1) tumour differentiation score (1–3), (2) mitotic count per 10 HPF (1–3), (3) necrosis extent (0–2). Sum = grade. Grade 1 = 2–3 pts; Grade 2 = 4–5 pts; Grade 3 = 6–8 pts. Grade 3 = highest risk. Used in Harrison\'s ch96 to stratify adjuvant therapy.',
      literal: 'Source: Harrison\'s 22e ch96',
    },
    {
      it: 'R0 resection — why it matters more than any other variable',
      meaning: 'R0 (microscopically clear margins) = the single most important MODIFIABLE prognostic factor across all sarcoma histotypes. R1 = microscopic positive margin. R2 = macroscopic residual disease. Stage, grade, histotype influence prognosis but R0 is the one the surgeon controls. Manage at a high-volume sarcoma centre.',
      literal: 'Source: Harrison\'s 22e ch96 + AJCC staging',
    },
    {
      it: 'Metastatic > Primary: the lung-sarcoma rule',
      meaning: 'Sarcoma METASTASISES to the lung far more often than it arises there. Any spindle-cell pulmonary tumour = metastatic until proven otherwise. MANDATORY: full staging with PET/CT before diagnosing primary pulmonary sarcoma. Missing an extrapulmonary primary changes staging, surgery plan, and systemic therapy entirely.',
      literal: 'Source: Gemini grounded research',
    },
    {
      it: 'PAIS prognosis and surgical approach',
      meaning: 'Without surgery: median survival often < 18 months. Treatment = radical pulmonary endarterectomy or sleeve resection (analogous to approach for CTEPH). Adjuvant chemo considered. Key preoperative test: MDM2 FISH on biopsy + PET/MRI to distinguish viable tumour from thrombus. Refer to expert sarcoma/thoracic centre.',
      literal: 'Source: Gemini grounded research + Harrison\'s 22e ch282',
    },
  ],
});

const srCardCss = emitSrCardCss();

// ============================================================================
// INLINE CSS — token-only, all values via --chiron-* vars
// Includes: theme tokens, widget CSS (MCQ + agreement matrix), SR card CSS,
// shell layout (L5 textbook style from klinefelter reference)
// ============================================================================

const tokensCss = `
/* ── chiron token defaults ─────────────────────────────────── */
:root {
  --chiron-bg: #ffffff;
  --chiron-surface: #f8fafc;
  --chiron-elevated: #eef4fb;
  --chiron-fg: #0f1f33;
  --chiron-fg-secondary: #334155;
  --chiron-muted: #64748b;
  --chiron-accent: #1e6fbf;
  --chiron-accent-light: #3a8edb;
  --chiron-warm-accent: #0d9488;
  --chiron-success: #15803d;
  --chiron-warning: #b45309;
  --chiron-error: #b91c1c;
  --chiron-info: #1e6fbf;
  --chiron-border: #d8e3f0;
  --chiron-divider: #e6eef7;
  --chiron-font-heading: 'Inter', system-ui, -apple-system, sans-serif;
  --chiron-font-body: 'Source Sans 3', 'Inter', system-ui, sans-serif;
  --chiron-font-mono: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  --chiron-space-1: 0.25rem;
  --chiron-space-2: 0.5rem;
  --chiron-space-3: 0.75rem;
  --chiron-space-4: 1rem;
  --chiron-space-5: 1.25rem;
  --chiron-space-6: 1.5rem;
  --chiron-space-8: 2rem;
  --chiron-radius-sm: 4px;
  --chiron-radius-md: 8px;
  --chiron-radius-lg: 12px;
  --chiron-shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --chiron-shadow-md: 0 4px 6px rgba(0,0,0,0.07);
  --chiron-is-dark: 0;
}
`;

const shellCss = `
/* ── Shell reset + layout ─────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
  background: var(--chiron-bg);
  color: var(--chiron-fg);
  font-family: var(--chiron-font-body);
  font-size: 16px;
  line-height: 1.65;
}

/* ── Sidebar ───────────────────────────────────────────────── */
aside.side {
  background: var(--chiron-surface);
  border-right: 1px solid var(--chiron-border);
  padding: var(--chiron-space-6) var(--chiron-space-5);
  overflow-y: auto;
  height: 100vh;
  position: sticky;
  top: 0;
}
.side .brand {
  font-family: var(--chiron-font-heading);
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--chiron-accent);
  margin-bottom: var(--chiron-space-2);
}
.side .brand .dot { color: var(--chiron-warm-accent); }
.side .sub {
  font-size: 0.78rem;
  color: var(--chiron-muted);
  margin-bottom: var(--chiron-space-6);
  line-height: 1.4;
}
.side .toc-header {
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--chiron-muted);
  margin: var(--chiron-space-6) 0 var(--chiron-space-3);
}
.side .toc-link {
  display: flex;
  gap: var(--chiron-space-2);
  padding: var(--chiron-space-2) var(--chiron-space-3);
  border-radius: var(--chiron-radius-sm);
  color: var(--chiron-fg-secondary);
  text-decoration: none;
  font-size: 0.85rem;
  line-height: 1.35;
  margin-bottom: 2px;
}
.side .toc-link:hover { background: var(--chiron-elevated); color: var(--chiron-fg); }
.side .toc-link.active {
  background: var(--chiron-elevated);
  color: var(--chiron-accent);
  border-left: 3px solid var(--chiron-accent);
  padding-left: calc(var(--chiron-space-3) - 3px);
}
.side .toc-num {
  font-family: var(--chiron-font-mono, monospace);
  color: var(--chiron-muted);
  flex-shrink: 0;
  font-size: 0.8rem;
}

/* ── Main ──────────────────────────────────────────────────── */
main.main { overflow-y: auto; height: 100vh; }

/* ── Chapter layout ────────────────────────────────────────── */
section.chapter {
  max-width: 1500px;
  margin: 0 auto;
  padding: 3rem 3rem 5rem;
}
section.chapter > .ch-num {
  font-family: var(--chiron-font-mono, monospace);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--chiron-muted);
  font-size: 0.75rem;
}
section.chapter > h1 {
  font-family: var(--chiron-font-heading);
  font-size: 2.1rem;
  line-height: 1.2;
  margin: var(--chiron-space-2) 0 var(--chiron-space-4);
  color: var(--chiron-fg);
  max-width: 75ch;
}
section.chapter > .objective {
  font-style: italic;
  color: var(--chiron-fg-secondary);
  border-left: 3px solid var(--chiron-accent);
  padding-left: var(--chiron-space-4);
  margin-bottom: var(--chiron-space-6);
  max-width: 75ch;
}
section.chapter > p {
  max-width: 75ch;
  margin: var(--chiron-space-4) 0;
  color: var(--chiron-fg);
}
.hy, .pearl, .mnemonic {
  background: var(--chiron-elevated);
  border-left: 3px solid var(--chiron-accent);
  border-radius: var(--chiron-radius-sm);
  padding: var(--chiron-space-4);
  margin: var(--chiron-space-4) 0;
  max-width: 75ch;
}
.pearl { border-left-color: var(--chiron-warm-accent); }
.hy-title, .pearl-title {
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--chiron-muted);
  margin-bottom: var(--chiron-space-2);
}
.hy ul { margin: 0; padding-left: var(--chiron-space-5); }
.hy li { margin: var(--chiron-space-2) 0; }

/* ── Widget section label ──────────────────────────────────── */
.widget-section-label {
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--chiron-muted);
  margin: var(--chiron-space-8) 0 var(--chiron-space-2);
}

/* ── SR deck container ─────────────────────────────────────── */
.sr-deck-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--chiron-space-4);
  margin: var(--chiron-space-4) 0 var(--chiron-space-8);
}
.sr-deck-container .sr-card {
  background: var(--chiron-surface);
  border: 1px solid var(--chiron-border);
  border-radius: var(--chiron-radius-md);
  cursor: pointer;
  transition: box-shadow 0.15s;
  box-shadow: var(--chiron-shadow-sm);
}
.sr-deck-container .sr-card:hover { box-shadow: var(--chiron-shadow-md); }
.sr-deck-help {
  font-size: 0.82rem;
  color: var(--chiron-muted);
  margin-bottom: var(--chiron-space-3);
  font-style: italic;
}

/* ── Footer ────────────────────────────────────────────────── */
footer.lesson-footer {
  padding: var(--chiron-space-5) 3rem;
  color: var(--chiron-muted);
  font-size: 0.78rem;
  border-top: 1px solid var(--chiron-divider);
  max-width: 1500px;
  margin: 0 auto;
}

/* ── Mobile ────────────────────────────────────────────────── */
@media (max-width: 880px) {
  body { grid-template-columns: 1fr; }
  aside.side {
    position: relative;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--chiron-border);
    padding: var(--chiron-space-4) var(--chiron-space-5);
  }
  section.chapter { padding: 2rem 1.25rem 4rem; }
}
`;

const widgetCss = `
/* ── MCQ Clinical Vignette widget ──────────────────────────── */
.mcq-clinical-vignette {
  background: var(--chiron-surface);
  border: 1px solid var(--chiron-border);
  border-radius: var(--chiron-radius-md);
  padding: var(--chiron-space-6);
  margin: var(--chiron-space-6) 0;
  max-width: 820px;
}
.vignette-block {
  background: var(--chiron-elevated);
  border-left: 4px solid var(--chiron-accent);
  border-radius: var(--chiron-radius-sm);
  padding: var(--chiron-space-4) var(--chiron-space-5);
  margin-bottom: var(--chiron-space-4);
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--chiron-fg);
}
.key-info-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--chiron-space-2);
  margin-top: var(--chiron-space-3);
}
.chip {
  background: var(--chiron-accent);
  color: #fff;
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.72rem;
  padding: 3px 8px;
  border-radius: 3px;
}
.leading-question {
  font-family: var(--chiron-font-heading);
  font-weight: 600;
  font-size: 1rem;
  color: var(--chiron-fg);
  margin: var(--chiron-space-4) 0 var(--chiron-space-3);
}
.options {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--chiron-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--chiron-space-2);
}
.option {
  border: 1px solid var(--chiron-border);
  border-radius: var(--chiron-radius-sm);
  padding: var(--chiron-space-3) var(--chiron-space-4);
  transition: background 0.1s;
}
.option:hover { background: var(--chiron-elevated); }
.option.correct { border-color: var(--chiron-success); background: #f0fdf4; }
.option.incorrect { border-color: var(--chiron-error); background: #fef2f2; }
.option.selected { outline: 2px solid var(--chiron-accent); outline-offset: -2px; }
.option-label {
  display: flex;
  gap: var(--chiron-space-3);
  align-items: flex-start;
  cursor: pointer;
}
.option-letter {
  font-family: var(--chiron-font-mono, monospace);
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--chiron-accent);
  flex-shrink: 0;
  padding-top: 2px;
}
.option-text { font-size: 0.94rem; line-height: 1.55; }
.explanation {
  margin-top: var(--chiron-space-2);
  padding: var(--chiron-space-2) var(--chiron-space-3);
  background: var(--chiron-bg);
  border-left: 2px solid var(--chiron-muted);
  font-size: 0.86rem;
  color: var(--chiron-fg-secondary);
  line-height: 1.55;
}
.option.correct .explanation { border-left-color: var(--chiron-success); }
.option.incorrect .explanation { border-left-color: var(--chiron-error); }
.mcv-controls {
  display: flex;
  align-items: center;
  gap: var(--chiron-space-4);
  margin: var(--chiron-space-3) 0;
}
.check-button {
  background: var(--chiron-accent);
  color: #fff;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  padding: 8px 20px;
  border: none;
  border-radius: var(--chiron-radius-sm);
  cursor: pointer;
}
.check-button:hover { background: var(--chiron-accent-light); }
.check-button:disabled { opacity: 0.5; cursor: default; }
.mcv-feedback { font-size: 0.88rem; font-weight: 600; }
.mcv-feedback.correct { color: var(--chiron-success); }
.mcv-feedback.incorrect { color: var(--chiron-error); }
.hammer-chip {
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.75rem;
  color: var(--chiron-muted);
  margin-top: var(--chiron-space-2);
}
.attending-tip {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-left: 4px solid var(--chiron-warning);
  border-radius: var(--chiron-radius-sm);
  padding: var(--chiron-space-4);
  margin-top: var(--chiron-space-4);
  font-size: 0.88rem;
  line-height: 1.6;
  color: var(--chiron-fg);
}
.attending-tip strong { color: var(--chiron-warning); }
.attending-tip p { margin: var(--chiron-space-2) 0 0; }

/* ── Agreement Matrix widget ───────────────────────────────── */
.agreement-matrix {
  background: var(--chiron-surface);
  border: 1px solid var(--chiron-border);
  border-radius: var(--chiron-radius-md);
  padding: var(--chiron-space-6);
  margin: var(--chiron-space-6) 0;
  max-width: 820px;
  overflow-x: auto;
}
.prompt-text {
  font-weight: 600;
  font-family: var(--chiron-font-heading);
  margin-bottom: var(--chiron-space-4);
  color: var(--chiron-fg);
}
.matrix {
  width: 100%;
  border-collapse: collapse;
}
.matrix th, .matrix td {
  padding: var(--chiron-space-3) var(--chiron-space-3);
  border-bottom: 1px solid var(--chiron-divider);
  text-align: center;
  vertical-align: middle;
}
.matrix th:first-child, .matrix td.statement { text-align: left; width: 55%; }
.matrix thead th {
  font-family: var(--chiron-font-mono, monospace);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--chiron-muted);
  border-bottom: 2px solid var(--chiron-border);
}
.matrix td.statement {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--chiron-fg);
  padding-right: var(--chiron-space-5);
}
.matrix tbody tr.correct td { background: #f0fdf4; }
.matrix tbody tr.incorrect td { background: #fef2f2; }
.matrix tbody tr.unanswered td { background: #fffbeb; }
.am-controls {
  display: flex;
  align-items: center;
  gap: var(--chiron-space-4);
  margin-top: var(--chiron-space-4);
}
.am-feedback { font-size: 0.88rem; font-weight: 600; }
.am-feedback.correct { color: var(--chiron-success); }
.am-feedback.incorrect { color: var(--chiron-warning); }
.rationale {
  margin-top: var(--chiron-space-4);
  padding: var(--chiron-space-4);
  background: var(--chiron-elevated);
  border-radius: var(--chiron-radius-sm);
}
.rationale ol {
  list-style: decimal;
  padding-left: var(--chiron-space-6);
  margin: 0;
}
.rationale-row {
  font-size: 0.86rem;
  line-height: 1.6;
  color: var(--chiron-fg-secondary);
  margin: var(--chiron-space-3) 0;
}
`;

// ============================================================================
// CHAPTERS (intro + vignettes + matrix + SR deck)
// ============================================================================

const CHAPTERS = [
  {
    id: 'ch-intro',
    num: 1,
    title: 'Sarcoma of the Chest — Clinical Orientation',
    objective: 'Understand why thoracic sarcomas are treacherous: they mimic carcinoma (PPS), mimic pulmonary embolism (PAIS), and demand R0 surgery as the cornerstone of management.',
    blocks: [
      `<p>Sarcomas arising in the chest are rare, high-stakes diagnoses that are consistently underdiagnosed at first presentation. The three chief failure modes are: (1) calling primary pulmonary sarcoma an NSCLC and giving the wrong chemotherapy; (2) diagnosing pulmonary artery intimal sarcoma as chronic PE and anticoagulating a tumour; (3) performing inadequate-margin excision of a chest-wall chondrosarcoma, condemning the patient to local recurrence.</p>`,
      `<p>This lesson tests clinical reasoning across all four thoracic sarcoma subsites — pulmonary artery, lung parenchyma, chest wall, and mediastinum — using grounded content from Harrison's 22e (ch96, ch282, ch83) and Gemini grounded research.</p>`,
      `<aside class="hy"><div class="hy-title">High yield — three must-not-miss rules</div><ul>
        <li><strong>MDM2 amplification (12q13-15)</strong> = PAIS. Failing anticoagulation = rule out intimal sarcoma.</li>
        <li><strong>SS18-SSX fusion</strong> = synovial sarcoma, regardless of site. Pathognomonic.</li>
        <li><strong>R0 margins</strong> = the single most important modifiable prognostic factor across all sarcoma histotypes.</li>
      </ul></aside>`,
    ],
  },
  {
    id: 'ch-vignettes',
    num: 2,
    title: 'Clinical Vignettes (4)',
    objective: 'Work through four USMLE-style vignettes covering the key diagnostic and management decisions across thoracic sarcoma subsites.',
    blocks: [
      `<div class="widget-section-label">Vignette 1 — Pulmonary Artery Intimal Sarcoma (PAIS)</div>`,
      vignette1,
      `<div class="widget-section-label">Vignette 2 — Primary Pulmonary Synovial Sarcoma</div>`,
      vignette2,
      `<div class="widget-section-label">Vignette 3 — Chest Wall Chondrosarcoma</div>`,
      vignette3,
      `<div class="widget-section-label">Vignette 4 — Sarcoma vs Carcinoma: Diagnostic Reasoning</div>`,
      vignette4,
    ],
  },
  {
    id: 'ch-matrix',
    num: 3,
    title: 'Always / Sometimes / Never — Reasoning Rules',
    objective: 'Classify eight thoracic sarcoma clinical rules. Each classification is grounded in the Harrison\'s / Gemini source material.',
    blocks: [
      agreementMatrix,
    ],
  },
  {
    id: 'ch-sr',
    num: 4,
    title: 'SR Flashcard Deck — 8 High-Yield Cards',
    objective: 'Click any card to flip. Front = concept. Back = key fact + source. Review before your next clinical case.',
    blocks: [
      `<p class="sr-deck-help">Click any card to flip. Front = concept or entity. Back = key facts grounded in Harrison's 22e / Gemini research.</p>`,
      `<div class="sr-deck-container">${srCards}</div>`,
    ],
  },
];

const chaptersHtml = CHAPTERS.map(ch => `
  <section class="chapter" id="${ch.id}">
    <div class="ch-num">Chapter ${ch.num}</div>
    <h1>${ch.title}</h1>
    <div class="objective"><strong>Objective.</strong> ${ch.objective}</div>
    ${ch.blocks.join('\n')}
  </section>`).join('\n');

const sidebarToc = CHAPTERS.map(ch =>
  `<a class="toc-link" href="#${ch.id}" data-chapter-target="${ch.id}"><span class="toc-num">${ch.num}.</span><span class="toc-title">${ch.title.replace(/ — .*$/, '')}</span></a>`
).join('\n');

// ============================================================================
// FULL HTML
// ============================================================================

const html = `<!DOCTYPE html>
<html lang="en" data-theme="clinical">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chiron · Sarcoma of the Chest</title>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet" />

  <style>
${tokensCss}
${shellCss}
${widgetCss}
${srCardCss}
  </style>
</head>
<body>
  <aside class="side">
    <div class="brand">Chiron<span class="dot">·</span></div>
    <div class="sub">Sarcoma of the Chest<br>Medicine · Clinical Reasoning</div>

    <div class="toc-header">Chapters</div>
${sidebarToc}
  </aside>

  <main class="main">
${chaptersHtml}

    <footer class="lesson-footer">
      Chiron · Sarcoma of the Chest · Medicine domain test · ${new Date().toISOString().slice(0, 10)}<br>
      Grounded in Harrison's 22e ch96/282/83 + Gemini grounded research on PPS/PAIS/chest-wall sarcomas.
    </footer>
  </main>

  <script>
    // SR card flip
    document.querySelectorAll('.sr-card').forEach(function(card) {
      card.addEventListener('click', function() { card.classList.toggle('flipped'); });
    });

    // Sidebar TOC scrollspy
    var tocLinks = document.querySelectorAll('.toc-link');
    tocLinks.forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        var target = document.querySelector(a.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    var chapters = Array.from(document.querySelectorAll('section.chapter'));
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) {
          var id = e.target.id;
          tocLinks.forEach(function(a) {
            a.classList.toggle('active', a.getAttribute('data-chapter-target') === id);
          });
        }
      });
    }, { rootMargin: '-30% 0px -55% 0px' });
    chapters.forEach(function(c) { io.observe(c); });
  </script>
</body>
</html>`;

writeFileSync(OUT, html);
console.error('[sarcoma-build] Wrote:', OUT);
console.error('[sarcoma-build] Length:', html.length, 'chars');
console.error('[sarcoma-build] Vignettes: 4 | Agreement-matrix: 1 | SR cards: 8');
console.error('[sarcoma-build] Widgets used: renderMcqClinicalVignette ×4, renderAgreementMatrix ×1, emitSrDeck ×1');
