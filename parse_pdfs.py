#!/usr/bin/env python3
"""Parse ABFM ITE PDFs into structured JSON."""
import pymupdf
import json
import re
import sys
from pathlib import Path

def extract_text(pdf_path):
    doc = pymupdf.open(pdf_path)
    text = ""
    for page in doc:
        text += page.get_text() + "\n"
    doc.close()
    # Drop page-number footers (bare 1-3 digit lines) and "Item #N" image-page
    # headers, which otherwise leak into the last answer choice on each page.
    lines = [
        ln for ln in text.split("\n")
        if not re.fullmatch(r"\s*\d{1,3}\s*", ln) and not re.fullmatch(r"\s*Item\s*#\d+\s*", ln)
    ]
    return "\n".join(lines)

def parse_multchoice(text):
    """Parse mult choice PDF into list of {id, question, choices: {A:..., B:...}}."""
    # Split by question numbers at start of line
    # Pattern: number followed by period and space at beginning of line
    parts = re.split(r'\n(?=\d+\.\s)', text)
    
    questions = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        
        # Extract question number
        m = re.match(r'(\d+)\.\s*(.*)', part, re.DOTALL)
        if not m:
            continue
        
        qnum = int(m.group(1))
        rest = m.group(2)
        
        # Split choices: look for A) ... B) ... etc
        # Choices may span multiple lines
        choices = {}
        choice_pattern = re.compile(r'\n([A-E])\)\s+(.*?)(?=\n[A-E]\)|\n\d+\.\s|\Z)', re.DOTALL)
        
        # First, extract the question stem (everything before A))
        stem_match = re.match(r'(.*?)\nA\)\s', rest, re.DOTALL)
        if stem_match:
            stem = stem_match.group(1).strip()
        else:
            stem = rest.strip()
        
        # Extract choices
        for cm in choice_pattern.finditer(rest):
            letter = cm.group(1)
            choice_text = cm.group(2).strip()
            # Clean up newlines within choices
            choice_text = re.sub(r'\s+', ' ', choice_text)
            choices[letter] = choice_text
        
        if stem and choices:
            questions.append({
                "id": qnum,
                "question": stem,
                "choices": choices
            })
    
    return questions

def parse_critique(text):
    """Parse critique PDF into dict of {item_num: {answer, explanation}}."""
    # Split by "Item N"
    parts = re.split(r'\nItem\s+(\d+)\s*\n', text)
    
    critiques = {}
    
    # parts[0] is preamble, then pairs of (num, content)
    for i in range(1, len(parts), 2):
        if i+1 >= len(parts):
            break
        try:
            item_num = int(parts[i])
        except ValueError:
            continue
        
        content = parts[i+1].strip()
        
        # Extract ANSWER: X
        ans_match = re.search(r'ANSWER:\s*([A-E])', content)
        if not ans_match:
            continue
        
        answer = ans_match.group(1)
        
        # Extract explanation (everything after ANSWER: X until References or next item)
        # Remove the ANSWER line
        expl_start = ans_match.end()
        explanation = content[expl_start:].strip()
        
        # Remove References section. The header line may carry stray spaces,
        # and some years run the citation into the same line, so also cut at
        # "Reference(s) Lastname AB," author patterns.
        explanation = re.split(r'\n\s*References?\s*:?\s*\n', explanation)[0]
        explanation = re.split(r'\bReferences?\b:?(?=\s+[A-Z][\w\'’-]+\s+[A-Z]{1,3}[,.])', explanation)[0].strip()
        
        # Clean up
        explanation = re.sub(r'\s+', ' ', explanation)
        
        critiques[item_num] = {
            "answer": answer,
            "explanation": explanation
        }
    
    return critiques

def classify_domain(question_text):
    """Classify question into a medical domain based on keyword scoring."""
    text = question_text.lower()
    
    domains = {
        "Cardiovascular": [
            "hypertension", "hypertensive", "blood pressure", "antihypertensive",
            "aldosterone", "statin", "anticoagulation", "warfarin", "apixaban",
            "atrial fibrillation", "acute coronary", "myocardial infarction", "heart failure",
            "aortic stenosis", "mitral regurgitation", "pericarditis", "endocarditis",
            "deep vein thrombosis", "pulmonary embolism", "peripheral arterial",
            "carotid stenosis", "abdominal aortic", "venous insufficiency",
            "qt prolongation", "torsades", "defibrillator", "pacemaker",
            "antiarrhythmic", "beta blocker", "ace inhibitor", "arb ", "calcium channel",
            "cardiac rehab", "stress test", "echocardiogram", "angiogram",
            "chest pain", "palpitation", "syncope", "edema",
        ],
        "Respiratory": [
            "asthma", "copd", "pneumonia", "pneumothorax", "pleural effusion",
            "pulmonary nodule", "lung cancer", "bronchitis", "bronchiectasis",
            "tuberculosis", "sleep apnea", "obstructive sleep", "spirometry",
            "inhaler", "nebulizer", "oxygen saturation", "pulse oximetry",
            "shortness of breath", "dyspnea", "wheeze", "hemoptysis",
            "smoking cessation", "tobacco use",
        ],
        "Endocrine/Metabolic": [
            "diabetes mellitus", "type 1 diabetes", "type 2 diabetes", "a1c", "hemoglobin a1c",
            "hyperglycemia", "hypoglycemia", "insulin", "metformin", "glp-1",
            "thyroid", "hypothyroidism", "hyperthyroidism", "tsh", "levothyroxine",
            "osteoporosis", "dexamethasone", "dexamethasone suppression",
            "cushing", "addison", "adrenal insufficiency",
            "parathyroid", "hypercalcemia", "hypocalcemia",
            "vitamin d deficiency", "pituitary",
            "obesity", "bariatric", "weight loss",
            "metabolic syndrome", "dyslipidemia",
            "lipid panel", "ldl", "hdl", "triglyceride",
            "diabetic ketoacidosis", "dka", "hhs",
        ],
        "Gastrointestinal": [
            "abdominal pain", "diarrhea", "constipation", "gastroesophageal reflux", "gerd",
            "peptic ulcer", "gastritis", "h. pylori", "dysphagia", "odynophagia",
            "hepatitis", "cirrhosis", "fatty liver", "liver function", "alt", "ast",
            "gallbladder", "cholecystitis", "cholelithiasis", "biliary",
            "pancreatitis", "inflammatory bowel", "crohn", "ulcerative colitis",
            "celiac disease", "irritable bowel", "diverticulitis",
            "colon cancer", "colorectal cancer", "colonoscopy", "fecal occult",
            "upper endoscopy", "gi bleed", "melena", "hematochezia",
            "nausea", "vomiting", "appendicitis",
        ],
        "Musculoskeletal": [
            "back pain", "low back pain", "sciatica", "spinal stenosis",
            "osteoarthritis", "rheumatoid arthritis", "gout", "pseudogout",
            "rotator cuff", "adhesive capsulitis", "shoulder",
            "carpal tunnel", "trigger finger", "de quervain",
            "hip fracture", "knee pain", "meniscal tear", "acl",
            "plantar fasciitis", "achilles tendon",
            "fibromyalgia", "polymyalgia rheumatica",
            "fracture", "sprain", "strain", "tendonitis", "bursitis",
            "sports medicine", "physical therapy",
        ],
        "Neurology": [
            "headache", "migraine", "cluster headache", "tension headache",
            "seizure", "epilepsy", "status epilepticus",
            "stroke", "transient ischemic attack", "tia",
            "dementia", "alzheimer", "cognitive impairment", "mini-mental",
            "parkinson", "tremor", "essential tremor",
            "multiple sclerosis", "optic neuritis",
            "peripheral neuropathy", "diabetic neuropathy",
            "bell palsy", "facial nerve",
            "vertigo", "dizziness", "meniere",
            "concussion", "traumatic brain", "subdural hematoma",
            "meningitis", "encephalitis",
            "guillain-barre", "myasthenia gravis",
        ],
        "Psychiatry/Behavioral": [
            "depression", "major depressive", "phq-9", "ssri", "snri",
            "anxiety", "generalized anxiety", "panic disorder", "gad-7",
            "bipolar", "mania", "lithium", "valproate",
            "schizophrenia", "psychosis", "antipsychotic",
            "adhd", "attention deficit",
            "posttraumatic stress", "ptsd",
            "obsessive-compulsive", "ocd",
            "substance use", "alcohol use", "opioid use", "cage",
            "suicidal", "suicide risk",
            "insomnia", "sleep disorder",
            "cognitive behavioral therapy", "psychotherapy",
        ],
        "Dermatology": [
            "rash", "dermatitis", "eczema", "psoriasis",
            "acne", "rosacea", "hidradenitis",
            "cellulitis", "abscess", "impetigo", "erysipelas",
            "melanoma", "basal cell", "squamous cell", "skin cancer",
            "actinic keratosis", "seborrheic keratosis",
            "herpes zoster", "shingles", "herpes simplex",
            "tinea", "onychomycosis", "candidiasis",
            "urticaria", "angioedema", "pruritus",
            "burn", "wound care", "pressure ulcer",
            "hair loss", "alopecia", "nail",
        ],
        "Obstetrics/Gynecology": [
            "pregnancy", "prenatal", "antepartum", "postpartum",
            "labor", "delivery", "cesarean", "induction",
            "preeclampsia", "eclampsia", "gestational diabetes",
            "contraception", "iud", "oral contraceptive", "birth control",
            "menstrual", "menorrhagia", "amenorrhea", "dysmenorrhea",
            "menopause", "hormone replacement", "hot flash",
            "uterine", "endometrial", "fibroid", "leiomyoma",
            "ovarian", "polycystic ovary", "pcos", "ovarian cancer",
            "cervical", "pap smear", "hpv", "colposcopy",
            "breast cancer", "mammogram", "breast mass", "mastitis",
            "vaginitis", "bacterial vaginosis", "sexually transmitted",
            "ectopic pregnancy", "miscarriage", "spontaneous abortion",
            "abnormal uterine bleeding",
            "infertility", "hcg", "pregnancy test",
        ],
        "Pediatrics": [
            "child", "pediatric", "infant", "newborn", "neonatal",
            "adolescent", "teen", "school-age",
            "growth chart", "developmental milestone", "failure to thrive",
            "immunization", "vaccine", "vaccination schedule",
            "congenital", "birth defect",
            "breastfeeding", "formula feeding",
            "otitis media", "acute otitis", "pharyngitis",
            "bronchiolitis", "croup", "rsv",
            "febrile seizure", "kawasaki",
            "child abuse", "neglect",
            "jaundice", "hyperbilirubinemia",
        ],
        "Renal/Urology": [
            "chronic kidney disease", "ckd", "end-stage renal",
            "acute kidney injury", "aki", "creatinine", "gfr",
            "dialysis", "hemodialysis", "peritoneal dialysis",
            "urinary tract infection", "uti", "cystitis", "pyelonephritis",
            "prostate", "bph", "benign prostatic", "prostate cancer",
            "urinary incontinence", "overactive bladder", "stress incontinence",
            "hematuria", "proteinuria",
            "nephrolithiasis", "kidney stone", "renal calculus",
            "hyponatremia", "hypernatremia", "hypokalemia", "hyperkalemia",
            "electrolyte", "acid-base",
        ],
        "Hematology/Oncology": [
            "anemia", "iron deficiency", "macrocytic", "microcytic", "hemolytic",
            "thrombocytopenia", "itp", "ttp", "platelet",
            "coagulopathy", "inr", "ptt", "bleeding disorder",
            "leukemia", "lymphoma", "hodgkin", "non-hodgkin",
            "multiple myeloma", "myelodysplastic",
            "chemotherapy", "radiation therapy", "adjuvant",
            "palliative care", "hospice", "end-of-life",
            "metastatic", "cancer screening", "remission",
            "neutropenia", "pancytopenia",
            "sickle cell", "thalassemia",
        ],
        "Infectious Disease": [
            "sepsis", "bacteremia", "septic shock",
            "hiv", "aids", "cd4", "antiretroviral",
            "meningitis", "encephalitis",
            "endocarditis", "osteomyelitis", "septic arthritis",
            "tuberculosis", "latent tb", "ppd", "quantiferon",
            "influenza", "covid-19", "sars-cov",
            "lyme disease", "tick-borne",
            "malaria", "travel medicine",
            "antibiotic resistance", "mrsa", "vre",
            "clostridium difficile", "c. diff",
            "cellulitis", "necrotizing fasciitis",
            "abscess", "empyema",
        ],
        "Preventive Medicine": [
            "uspstf", "preventive services", "screening guideline",
            "health maintenance", "annual physical", "wellness exam",
            "immunization", "adult vaccination", "vaccine schedule",
            "cancer screening", "mammogram", "colonoscopy", "pap smear",
            "counseling", "behavioral counseling",
            "chemoprevention", "aspirin prophylaxis",
            "genetic testing", "brca",
        ],
        "Ophthalmology/ENT": [
            "glaucoma", "cataract", "macular degeneration",
            "diabetic retinopathy", "retinal detachment",
            "conjunctivitis", "keratitis", "uveitis",
            "visual acuity", "vision loss", "refractive error",
            "lasik", "cataract surgery",
            "otitis", "ear infection", "tympanic membrane",
            "hearing loss", "tinnitus", "vertigo", "meniere",
            "sinusitis", "allergic rhinitis", "nasal polyp",
            "pharyngitis", "tonsillitis", "strep throat",
            "epistaxis", "nosebleed",
        ],
    }
    
    scores = {}
    for domain, keywords in domains.items():
        score = 0
        for kw in keywords:
            # Word-boundary match so short keywords like "ast" or "alt" don't
            # fire inside unrelated words ("fasting", "alternative").
            if re.search(r"\b" + re.escape(kw.strip()) + r"\b", text):
                score += 1
        if score > 0:
            scores[domain] = score
    
    if scores:
        return max(scores, key=scores.get)
    return "General Medicine"

def main():
    ite_dir = Path("/home/user/Projects/ite")
    
    all_questions = []
    years = ["2022", "2023", "2024", "2025"]
    
    for year in years:
        mc_path = ite_dir / f"{year}ITEMultChoice.pdf"
        crit_path = ite_dir / f"{year}ITECritique.pdf"
        
        if not mc_path.exists():
            print(f"Skipping {year}: no mult choice PDF", file=sys.stderr)
            continue
        
        print(f"Parsing {year}...")
        
        mc_text = extract_text(str(mc_path))
        questions = parse_multchoice(mc_text)
        print(f"  Found {len(questions)} questions in mult choice")
        
        if crit_path.exists():
            crit_text = extract_text(str(crit_path))
            critiques = parse_critique(crit_text)
            print(f"  Found {len(critiques)} critiques")
        else:
            critiques = {}
            print(f"  No critique PDF for {year}")
        
        # Merge
        for q in questions:
            qnum = q["id"]
            crit = critiques.get(qnum, {})
            q["year"] = int(year)
            q["correctAnswer"] = crit.get("answer", "")
            q["explanation"] = crit.get("explanation", "")
            q["domain"] = classify_domain(q["question"])
        
        all_questions.extend(questions)
    
    # Save to JSON
    out_path = ite_dir / "questions.json"
    with open(out_path, "w") as f:
        json.dump(all_questions, f, indent=2, ensure_ascii=False)
    
    print(f"\nTotal questions: {len(all_questions)}")
    print(f"Saved to {out_path}")
    
    # Print domain stats
    domains = {}
    for q in all_questions:
        d = q["domain"]
        domains[d] = domains.get(d, 0) + 1
    print("\nDomain distribution:")
    for d, c in sorted(domains.items(), key=lambda x: -x[1]):
        print(f"  {d}: {c}")

if __name__ == "__main__":
    main()
