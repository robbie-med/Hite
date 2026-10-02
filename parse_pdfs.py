#!/usr/bin/env python3
"""Parse ABFM ITE PDFs into structured JSON.

Usage:
    python3 parse_pdfs.py --dir /path/to/pdfs     # writes questions.json next to this script

For each year it looks for <year>ITEMultChoice.pdf and <year>ITECritique.pdf.
If a PDF is missing, a .txt with the same name (text pasted from the PDF) is
used instead.  None of these inputs may be committed (see .gitignore).
"""
import pymupdf
import base64
import json
import re
import sys
from pathlib import Path

def extract_text(pdf_path):
    # Drop page numbers and "Item #N" image-page headers, which otherwise leak
    # into the last answer choice on a page. A page number is a bare 1-3 digit
    # line that is the first or last text on its page. Bare numbers elsewhere are
    # content: numeric choices on their own line (2022 item 167, 2023 items
    # 47/115/116) and wrapped text ("…starting at age\n6", 2025 item 158).
    doc = pymupdf.open(pdf_path)
    lines = []
    for page in doc:
        page_lines = page.get_text().split("\n")
        filled = [i for i, ln in enumerate(page_lines) if ln.strip()]
        edges = {filled[0], filled[-1]} if filled else set()
        for i, ln in enumerate(page_lines):
            prev = page_lines[i - 1] if i else ""
            page_no = (i in edges and re.fullmatch(r"\s*\d{1,3}\s*", ln)
                       and not re.fullmatch(r"\s*[A-E]\)\s*", prev))
            if not page_no and not re.fullmatch(r"\s*Item\s*#\d+\s*", ln):
                lines.append(ln)
        lines.append("")
    doc.close()
    return "\n".join(lines)

def split_questions(text, max_items=200, window=6):
    """Yield (number, body) for each question.

    A line beginning "N. " starts a question only if N has not been seen yet
    and is close to the next expected number.  This rejects numbers inside a
    stem ("...Glasgow Coma Scale score of\n15. On examination..." in 2025
    item 123), tolerates an indented first item ("\n 1. \n..." in 2024) and
    survives PDFs whose text order puts an item a page late (2024 item 100
    comes after 102 in the extracted text)."""
    starts, seen, expected = [], set(), 1
    for m in re.finditer(r'(?:^|\n)[ \t]*(\d+)\.[ \t\n]', text):
        n = int(m.group(1))
        if n in seen or not (1 <= n <= max_items) or abs(n - expected) > window:
            continue
        seen.add(n)
        starts.append((n, m.start(1)))
        expected = max(seen) + 1
    for i, (num, pos) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(text)
        yield num, text[pos:end]


def parse_multchoice(text):
    """Parse mult choice PDF into list of {id, question, choices: {A:..., B:...}}."""
    questions = []
    for qnum, part in split_questions(text):
        part = part.strip()
        m = re.match(r'(\d+)\.\s*(.*)', part, re.DOTALL)
        if not m:
            continue
        rest = m.group(2)

        # Choices may span multiple lines: A) ... B) ... etc
        choices = {}
        choice_pattern = re.compile(r'\n([A-E])\)\s+(.*?)(?=\n[A-E]\)|\Z)', re.DOTALL)

        # The question stem is everything before the first "A)" line
        stem_match = re.match(r'(.*?)\nA\)\s', rest, re.DOTALL)
        stem = stem_match.group(1).strip() if stem_match else rest.strip()

        for cm in choice_pattern.finditer(rest):
            choices[cm.group(1)] = re.sub(r'\s+', ' ', cm.group(2).strip())

        if stem and choices:
            questions.append({"id": qnum, "question": stem, "choices": choices})
        else:
            print(f"  WARNING: could not parse item {qnum}", file=sys.stderr)
    questions.sort(key=lambda q: q["id"])
    return questions

def parse_critique(text):
    """Parse critique PDF (or pasted text) into dict of {item_num: {answer, explanation}}."""
    # Drop running page headers such as "2025 ITE RATIONALE BOOK – PAGE 12".
    text = re.sub(r'(?im)^\s*\d{4}\s+ITE\s+RATIONALE\s+BOOK\s*[–-]\s*PAGE\s+\d+\s*$', '', text)
    # Split by "Item N" (tolerate trailing spaces / blank lines)
    parts = re.split(r'\n\s*Item\s+(\d+)\s*\n', '\n' + text)
    
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

IMG_MAX_SIDE = 1200     # px; enough to read an ECG tracing, small enough to ship
IMG_QUALITY = 78


def _to_jpeg(doc, xref):
    """Embedded image → downscaled JPEG bytes (alpha flattened onto white)."""
    import io
    from PIL import Image
    pix = pymupdf.Pixmap(doc, xref)
    if pix.alpha or pix.n - pix.alpha not in (1, 3):
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.getchannel("A") if "A" in img.getbands() else None)
        img = bg
    img.thumbnail((IMG_MAX_SIDE, IMG_MAX_SIDE), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=IMG_QUALITY, optimize=True, progressive=True)
    return out.getvalue()


def extract_images(pdf_path, max_items=200, window=6):
    """Return {item number: [jpeg bytes, …]} for the clinical images in a mult-choice PDF.

    2022–2024 put each item's images on their own page headed "Item #N".
    2025 puts them inline, so an image belongs to the last item that starts
    above it on the page (or the item still running from the previous page).
    Item starts use the same plausibility window as split_questions().
    The cover page logo is skipped."""
    doc = pymupdf.open(pdf_path)
    out, current = {}, 0
    for pno, page in enumerate(doc):
        starts = []   # (y, n) item starts on this page, in reading order
        for b in page.get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                text = "".join(s["text"] for s in line["spans"])
                m = re.match(r"\s*(\d{1,3})\.(\s|$)", text)
                if m:
                    n = int(m.group(1))
                    if current < n <= min(max_items, current + window):
                        starts.append((line["bbox"][1], n)); current = n
        header = re.search(r"^\s*Item\s*#\s*(\d+)\s*$", page.get_text(), re.M)
        running = starts[0][1] - 1 if starts else current   # item continuing onto this page
        if pno == 0:
            continue
        placed = []
        for xref, *_ in page.get_images(full=True):
            for r in page.get_image_rects(xref) or []:
                if header:
                    n = int(header.group(1))
                else:
                    above = [s for y, s in starts if y <= r.y0 + 2]
                    n = above[-1] if above else running
                if 1 <= n <= max_items:
                    placed.append((r.y0, r.x0, n, xref))
        for _, _, n, xref in sorted(placed):
            out.setdefault(n, []).append(_to_jpeg(doc, xref))
    doc.close()
    return out


def read_source(path_pdf, path_txt):
    """Return text from the PDF if present, otherwise from a .txt with the same
    content (e.g. pasted from the PDF), otherwise None."""
    if path_pdf.exists():
        return extract_text(str(path_pdf))
    if path_txt.exists():
        return path_txt.read_text()
    return None


def main():
    import argparse
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dir", default=str(here),
                    help="Folder holding <year>ITEMultChoice.pdf and <year>ITECritique.pdf (or .txt). Default: repo root")
    ap.add_argument("--years", default="2022,2023,2024,2025")
    ap.add_argument("--out", default=str(here / "questions.json"))
    args = ap.parse_args()
    ite_dir = Path(args.dir)

    all_questions = []
    for year in [y.strip() for y in args.years.split(",") if y.strip()]:
        mc_text = read_source(ite_dir / f"{year}ITEMultChoice.pdf", ite_dir / f"{year}ITEMultChoice.txt")
        if mc_text is None:
            print(f"Skipping {year}: no mult choice PDF/txt", file=sys.stderr)
            continue
        print(f"Parsing {year}...")
        questions = parse_multchoice(mc_text)
        ids = {q["id"] for q in questions}
        missing = sorted(set(range(1, max(ids) + 1)) - ids) if ids else []
        print(f"  Found {len(questions)} questions in mult choice" + (f" (missing: {missing})" if missing else ""))

        crit_text = read_source(ite_dir / f"{year}ITECritique.pdf", ite_dir / f"{year}ITECritique.txt")
        if crit_text is not None:
            critiques = parse_critique(crit_text)
            print(f"  Found {len(critiques)} critiques")
        else:
            critiques = {}
            print(f"  No critique PDF/txt for {year}")

        pdf = ite_dir / f"{year}ITEMultChoice.pdf"
        images = extract_images(str(pdf)) if pdf.exists() else {}
        if images:
            kb = sum(len(b) for v in images.values() for b in v) // 1024
            print(f"  Found {sum(len(v) for v in images.values())} images for items {sorted(images)} ({kb} KB)")
        unanswered = []
        for q in questions:
            if q["id"] in images:
                q["images"] = ["data:image/jpeg;base64," + base64.b64encode(b).decode() for b in images[q["id"]]]
            elif re.search(r"\(shown (below|above)\)|\bshown below\b", q["question"]):
                print(f"  WARNING: item {q['id']} refers to an image but none was found", file=sys.stderr)
            crit = critiques.get(q["id"], {})
            q["year"] = int(year)
            q["correctAnswer"] = crit.get("answer", "")
            q["explanation"] = crit.get("explanation", "")
            q["domain"] = classify_domain(q["question"])
            if not q["correctAnswer"]:
                unanswered.append(q["id"])
        if unanswered:
            print(f"  WARNING: no answer key for items {unanswered} (they will be left out of the bank)", file=sys.stderr)
        all_questions.extend(questions)

    with open(args.out, "w") as f:
        json.dump(all_questions, f, indent=2, ensure_ascii=False)
    print(f"\nTotal questions: {len(all_questions)}")
    print(f"Saved to {args.out}")

    domains = {}
    for q in all_questions:
        domains[q["domain"]] = domains.get(q["domain"], 0) + 1
    print("\nDomain distribution:")
    for d, c in sorted(domains.items(), key=lambda x: -x[1]):
        print(f"  {d}: {c}")

if __name__ == "__main__":
    main()
