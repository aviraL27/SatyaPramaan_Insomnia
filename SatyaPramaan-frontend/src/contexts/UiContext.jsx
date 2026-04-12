import { createContext, useContext, useEffect, useMemo, useState } from "react"

const LANGUAGE_STORAGE_KEY = "satyapramaan_language"
const THEME_STORAGE_KEY = "satyapramaan_theme"

export const APP_NAME = "SatyaPramaan"

export const PAGE_TITLES = {
  "/app/dashboard": "Dashboard",
  "/app/issue-document": "Issue Document",
  "/app/documents": "Documents",
  "/app/verification-activity": "Verification Activity",
  "/app/audit-logs": "Audit Logs",
  "/app/trust-score": "Trust Score",
  "/app/profile": "Institution Profile",
}

const LanguageContext = createContext({
  language: "en",
  setLanguage: () => {},
  t: (value) => value,
})

const ThemeContext = createContext({
  theme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
})

const HI_TRANSLATIONS = {
  Language: "भाषा",
  English: "English",
  Hindi: "हिंदी",
  "Switch to Dark Mode": "डार्क मोड पर स्विच करें",
  "Switch to Light Mode": "लाइट मोड पर स्विच करें",
  Dashboard: "डैशबोर्ड",
  "Issue Document": "दस्तावेज जारी करें",
  Documents: "दस्तावेज",
  "Verification Activity": "सत्यापन गतिविधि",
  "Audit Logs": "ऑडिट लॉग्स",
  "Trust Score": "ट्रस्ट स्कोर",
  "Institution Profile": "संस्था प्रोफाइल",
  "Document Detail": "दस्तावेज विवरण",
  "Institution Workspace": "संस्था कार्यक्षेत्र",
  "Institution Console": "संस्था कंसोल",
  "Institution navigation": "संस्था नेविगेशन",
  Menu: "मेनू",
  Search: "खोजें",
  "Search documents, IDs, recipients": "दस्तावेज, आईडी, प्राप्तकर्ता खोजें",
  Logout: "लॉगआउट",
  "Public Verify": "सार्वजनिक सत्यापन",
  "Close navigation": "नेविगेशन बंद करें",
  "Open navigation": "नेविगेशन खोलें",
  "Welcome to SatyaPramaan": "SatyaPramaan में आपका स्वागत है",
  "SatyaPramaan home": "SatyaPramaan होम",
  "Proof Looks Better Than Promises.": "सबूत वादों से बेहतर दिखता है।",
  "Every issued document carries visible trust, cryptographic certainty, and instant verification.": "हर जारी दस्तावेज दृश्य भरोसा, क्रिप्टोग्राफिक निश्चितता और त्वरित सत्यापन के साथ आता है।",
  "Secure Access": "सुरक्षित प्रवेश",
  "Sign In": "साइन इन",
  Register: "रजिस्टर",
  "Register Institution": "संस्था पंजीकरण",
  "Access your institution workspace": "अपनी संस्था का कार्यक्षेत्र खोलें",
  "Create a trusted institution account": "विश्वसनीय संस्था खाता बनाएं",
  "Continue to dashboard, issuance, verification, and audit tools.": "डैशबोर्ड, जारीकरण, सत्यापन और ऑडिट टूल्स तक पहुंचें।",
  "Set up secure issuance roles and start publishing verifiable documents.": "सुरक्षित जारीकरण भूमिकाएँ सेट करें और सत्यापनीय दस्तावेज प्रकाशित करना शुरू करें।",
  "Firebase Config Missing": "Firebase कॉन्फ़िगरेशन उपलब्ध नहीं है",
  "Set VITE_FIREBASE_* values in frontend env before using sign-in or registration.": "साइन-इन या पंजीकरण से पहले frontend env में VITE_FIREBASE_* मान सेट करें।",
  "Work Email": "कार्य ईमेल",
  "Use your official institution domain email.": "अपना आधिकारिक संस्था डोमेन ईमेल उपयोग करें।",
  Password: "पासवर्ड",
  "Minimum 8 characters including one number.": "कम से कम 8 अक्षर, एक संख्या सहित।",
  Role: "भूमिका",
  "Institution Admin": "संस्था एडमिन",
  "Institution Operator": "संस्था ऑपरेटर",
  Verifier: "सत्यापनकर्ता",
  "Display Name": "डिस्प्ले नाम",
  "Institution Name": "संस्था का नाम",
  "Institution Code": "संस्था कोड",
  "Institution Type": "संस्था प्रकार",
  "Keep me signed in": "मुझे साइन-इन रखें",
  "Need help signing in?": "साइन-इन में मदद चाहिए?",
  "Authentication Error": "प्रमाणीकरण त्रुटि",
  "Please wait...": "कृपया प्रतीक्षा करें...",
  "Continue with Google": "Google के साथ जारी रखें",
  "Google OAuth uses your Firebase project and auto-creates backend profile if needed.": "Google OAuth आपके Firebase प्रोजेक्ट का उपयोग करता है और जरूरत पड़ने पर backend profile स्वतः बनाता है।",
  "or continue with email": "या ईमेल के साथ जारी रखें",
  "Create Account": "खाता बनाएं",
  "Operational Snapshot": "ऑपरेशनल स्नैपशॉट",
  "Trust-first operations, minus the noise.": "ट्रस्ट-केंद्रित संचालन, बिना अनावश्यक शोर के।",
  "Single-view confidence. Deep detail is already available in dedicated pages.": "एक नजर में भरोसा। विस्तृत विवरण समर्पित पेजों में पहले से उपलब्ध है।",
  "Issue New Document": "नया दस्तावेज जारी करें",
  "Current Trust Score": "वर्तमान ट्रस्ट स्कोर",
  "Band unavailable": "बैंड उपलब्ध नहीं",
  "Documents Issued": "जारी दस्तावेज",
  "Documents Verified": "सत्यापित दस्तावेज",
  "Tamper Alerts": "छेड़छाड़ अलर्ट",
  Audit: "ऑडिट",
  Trust: "ट्रस्ट",
  "Live from issuance records": "जारीकरण रिकॉर्ड से लाइव",
  "Live from verification activity": "सत्यापन गतिविधि से लाइव",
  "Derived from tamper signals": "छेड़छाड़ संकेतों से व्युत्पन्न",
  "Institution Health": "संस्था की स्थिति",
  "is connected with live issuance, verification, trust, and audit streams.": "लाइव जारीकरण, सत्यापन, ट्रस्ट और ऑडिट स्ट्रीम्स से जुड़ा है।",
  "Quick Platform Walkthrough": "प्लेटफॉर्म का त्वरित परिचय",
  "Watch the demo to learn issuance, verification, and audit flow in under two minutes.": "दो मिनट से कम में जारीकरण, सत्यापन और ऑडिट फ्लो समझने के लिए डेमो देखें।",
  "Start Here": "यहीं से शुरू करें",
  "Issue Flow": "जारीकरण प्रवाह",
  "Verify + Audit": "सत्यापन + ऑडिट",
  "SatyaPramaan Product Demo": "SatyaPramaan उत्पाद डेमो",
  "Real-time backend telemetry connected": "रियल-टाइम backend telemetry कनेक्टेड",
  "Open Documents, Verification Activity, or Audit Logs for full detail.": "पूर्ण विवरण के लिए Documents, Verification Activity या Audit Logs खोलें।",
  "Video slot is ready": "वीडियो स्लॉट तैयार है",
  "Share your link and I will wire it to play here.": "अपना लिंक साझा करें, मैं इसे यहां चलने के लिए जोड़ दूंगा।",
  "Recent Documents": "हाल के दस्तावेज",
  "View All": "सभी देखें",
  Title: "शीर्षक",
  Recipient: "प्राप्तकर्ता",
  Issued: "जारी",
  Status: "स्थिति",
  Verified: "सत्यापित",
  Tampered: "छेड़छाड़",
  Suspicious: "संदिग्ध",
  Revoked: "रद्द",
  Pending: "लंबित",
  Error: "त्रुटि",
  "Not Found": "नहीं मिला",
  Loading: "लोड हो रहा है",
  Action: "कार्रवाई",
  Actions: "कार्रवाइयां",
  "Action Type": "कार्रवाई प्रकार",
  "Action Error": "कार्रवाई त्रुटि",
  "Activity Error": "गतिविधि त्रुटि",
  Actor: "कर्ता",
  Attempt: "प्रयास",
  "Attempt ID": "प्रयास आईडी",
  "Attempt ID or Document ID": "प्रयास आईडी या दस्तावेज आईडी",
  "Audit Error": "ऑडिट त्रुटि",
  "Base score": "आधार स्कोर",
  Cancel: "रद्द करें",
  Complete: "पूर्ण",
  "Confirm Revocation": "रद्दीकरण की पुष्टि करें",
  "Confirm Revoke": "रद्द करने की पुष्टि करें",
  "Contact Phone": "संपर्क फोन",
  "Canonical metadata hash preview": "कैनोनिकल मेटाडेटा हैश पूर्वावलोकन",
  "Content hash": "सामग्री हैश",
  "Context Summary": "संदर्भ सारांश",
  "Copy Document ID": "दस्तावेज आईडी कॉपी करें",
  "Copy QR JSON": "QR JSON कॉपी करें",
  "Copy Verification Link": "सत्यापन लिंक कॉपी करें",
  "Could not load verification activity": "सत्यापन गतिविधि लोड नहीं हो सकी",
  "Could not load audit logs": "ऑडिट लॉग्स लोड नहीं हो सके",
  "Could not load trust score": "ट्रस्ट स्कोर लोड नहीं हो सका",
  "Could not update profile": "प्रोफाइल अपडेट नहीं हो सकी",
  "Could not render tamper highlights": "छेड़छाड़ हाइलाइट रेंडर नहीं हो सकीं",
  "Could not download document PDF": "दस्तावेज PDF डाउनलोड नहीं हो सका",
  "Current Chain Status": "वर्तमान चेन स्थिति",
  "Current Score": "वर्तमान स्कोर",
  "Date from": "तारीख से",
  "Date to": "तारीख तक",
  "Decision Basis": "निर्णय आधार",
  Detail: "विवरण",
  "Detector Evidence": "डिटेक्टर साक्ष्य",
  Document: "दस्तावेज",
  "Document Error": "दस्तावेज त्रुटि",
  "Document ID": "दस्तावेज आईडी",
  "Document Metadata": "दस्तावेज मेटाडेटा",
  "Document QR code": "दस्तावेज QR कोड",
  "Document Title": "दस्तावेज शीर्षक",
  "Document Type": "दस्तावेज प्रकार",
  "Choose File": "फाइल चुनें",
  "Document issued and signed successfully.": "दस्तावेज सफलतापूर्वक जारी और हस्ताक्षरित हुआ।",
  "Documents Referenced": "संदर्भित दस्तावेज",
  Done: "पूरा",
  "Download Entry JSON": "एंट्री JSON डाउनलोड करें",
  "Download Issued PDF": "जारी PDF डाउनलोड करें",
  "Download QR JSON": "QR JSON डाउनलोड करें",
  "Download QR PNG": "QR PNG डाउनलोड करें",
  "Download Selected PDF": "चयनित PDF डाउनलोड करें",
  "Draft Title": "ड्राफ्ट शीर्षक",
  "Entry Action Error": "एंट्री कार्रवाई त्रुटि",
  "Error and Empty States": "त्रुटि और खाली अवस्थाएं",
  "Export Signed Snapshot": "साइन किया हुआ स्नैपशॉट निर्यात करें",
  "Exporting...": "निर्यात हो रहा है...",
  "File Details": "फाइल विवरण",
  Filename: "फाइल नाम",
  "Filter by seq, action, actor, document ID, hash, or payload": "seq, कार्रवाई, कर्ता, दस्तावेज आईडी, हैश, या payload से फिल्टर करें",
  "Formula Breakdown": "सूत्र विवरण",
  "Generated after issue": "जारी करने के बाद जनरेट",
  "generated by backend during issuance": "जारीकरण के दौरान backend द्वारा जनरेट",
  "generated on issue": "जारी करते समय जनरेट",
  "Generated document ID": "जनरेटेड दस्तावेज आईडी",
  "Green border indicates no explicit changed regions were highlighted for this result.": "हरा बॉर्डर बताता है कि इस परिणाम में स्पष्ट परिवर्तित क्षेत्र हाइलाइट नहीं हुए।",
  "Hash Proof": "हैश प्रमाण",
  Healthy: "स्वस्थ",
  "Immutable Audit Ledger": "अपरिवर्तनीय ऑडिट लेजर",
  Institution: "संस्था",
  Integrity: "अखंडता",
  "Integrity Alerts": "अखंडता अलर्ट",
  "Integrity Status": "अखंडता स्थिति",
  Invalid: "अमान्य",
  "Invalid QR payload": "अमान्य QR payload",
  "Issuance Error": "जारीकरण त्रुटि",
  Issue: "जारी करें",
  "Issue Another Document": "एक और दस्तावेज जारी करें",
  "Issue detected": "समस्या पाई गई",
  "Issued At": "जारी समय",
  "Issued Date": "जारी तिथि",
  "Issued Document ID": "जारी दस्तावेज आईडी",
  "Issued Documents": "जारी दस्तावेज",
  "Issued document QR code": "जारी दस्तावेज QR कोड",
  Issuer: "जारीकर्ता",
  "Issuer Trust": "जारीकर्ता ट्रस्ट",
  "Issuer age contribution": "जारीकर्ता आयु योगदान",
  "Issuing Document...": "दस्तावेज जारी किया जा रहा है...",
  "Job Polling Error": "जॉब पोलिंग त्रुटि",
  "Last Integrity Verification": "अंतिम अखंडता सत्यापन",
  "Malformed signature payload.": "हस्ताक्षर payload गलत स्वरूप में है।",
  "Manual Document ID": "मैनुअल दस्तावेज आईडी",
  "Manual QR Payload Fallback": "मैनुअल QR payload फॉलबैक",
  "Manual document ID": "मैनुअल दस्तावेज आईडी",
  Metadata: "मेटाडेटा",
  "Metadata hash": "मेटाडेटा हैश",
  Method: "विधि",
  "Next Step": "अगला चरण",
  "No QR payload available for selected entry": "चयनित एंट्री के लिए QR payload उपलब्ध नहीं है",
  "No alterations were detected in this verification.": "इस सत्यापन में कोई परिवर्तन नहीं पाया गया।",
  "No altered regions were returned in this result.": "इस परिणाम में कोई बदला हुआ क्षेत्र नहीं मिला।",
  "No audit entries match your search.": "आपकी खोज से कोई ऑडिट एंट्री मेल नहीं खाती।",
  "No data available.": "कोई डेटा उपलब्ध नहीं है।",
  "No detector trigger metadata was returned": "कोई डिटेक्टर ट्रिगर मेटाडेटा वापस नहीं मिला",
  "No documents match current filters.": "वर्तमान फिल्टर से कोई दस्तावेज मेल नहीं खाता।",
  "No file selected": "कोई फाइल चयनित नहीं है",
  "No impacted pages": "कोई प्रभावित पेज नहीं",
  "No reason provided by backend.": "backend द्वारा कोई कारण प्रदान नहीं किया गया।",
  "No tamper findings": "कोई छेड़छाड़ निष्कर्ष नहीं",
  "No trust history yet": "अभी कोई ट्रस्ट इतिहास नहीं",
  "No verification attempts match current filters.": "वर्तमान फिल्टर से कोई सत्यापन प्रयास मेल नहीं खाता।",
  "No verification result": "कोई सत्यापन परिणाम नहीं",
  "Not Rated": "रेट नहीं किया गया",
  "Notes / Issuance Metadata": "नोट्स / जारीकरण मेटाडेटा",
  "OCR Layer": "OCR लेयर",
  "OCR changed words": "OCR बदले शब्द",
  "OCR confidence": "OCR विश्वसनीयता",
  "PDF File": "PDF फाइल",
  "PDF Upload": "PDF अपलोड",
  "PDF preview with QR placement": "QR प्लेसमेंट के साथ PDF पूर्वावलोकन",
  "PDF selected and ready for issuance.": "PDF चयनित है और जारीकरण के लिए तैयार है।",
  Page: "पेज",
  "Page Count": "पेज संख्या",
  "Paste QR payload": "QR payload पेस्ट करें",
  "Point camera at document QR": "कैमरा दस्तावेज QR पर रखें",
  "Preview shows page 1 with the issuance QR/signature block placed on the document.": "पूर्वावलोकन में पेज 1 पर जारीकरण QR/हस्ताक्षर ब्लॉक दिखता है।",
  "Preview status": "पूर्वावलोकन स्थिति",
  Previous: "पिछला",
  "Primary Domain": "प्रमुख डोमेन",
  "Profile Error": "प्रोफाइल त्रुटि",
  "Profile updated": "प्रोफाइल अपडेट हो गई",
  "Provide reason for revocation": "रद्दीकरण का कारण दें",
  "QR Evidence": "QR साक्ष्य",
  "QR Payload": "QR payload",
  "QR Placement + Signature Review": "QR प्लेसमेंट + हस्ताक्षर समीक्षा",
  "Ready for issuance signing": "जारीकरण हस्ताक्षर के लिए तैयार",
  "Reason Code": "कारण कोड",
  "Recipient Name": "प्राप्तकर्ता नाम",
  "Recipient Reference ID": "प्राप्तकर्ता संदर्भ आईडी",
  "Red overlays show changed regions detected in the uploaded PDF.": "लाल ओवरले अपलोड की गई PDF में बदले हुए क्षेत्र दिखाते हैं।",
  Replace: "बदलें",
  "Replace Document": "दस्तावेज बदलें",
  "Replacement PDF": "प्रतिस्थापन PDF",
  Result: "परिणाम",
  "Result Guide": "परिणाम मार्गदर्शिका",
  Results: "परिणाम",
  "Revocation Reason": "रद्दीकरण कारण",
  Revoke: "रद्द करें",
  "Revoke Document": "दस्तावेज रद्द करें",
  "Revoke Reason": "रद्द करने का कारण",
  "Revoking this document will mark all future verification attempts as revoked.": "इस दस्तावेज को रद्द करने पर भविष्य के सभी सत्यापन प्रयास रद्द चिह्नित होंगे।",
  "Run issuance to complete this step.": "इस चरण को पूरा करने के लिए जारीकरण चलाएं।",
  "Run verification from /verify or open /result with attemptId/jobId query parameters.": "/verify से सत्यापन चलाएं या attemptId/jobId query के साथ /result खोलें।",
  "Save Profile": "प्रोफाइल सहेजें",
  "Saving...": "सहेजा जा रहा है...",
  "Scan QR Code": "QR कोड स्कैन करें",
  "Scan and Verify": "स्कैन करें और सत्यापित करें",
  "Score History": "स्कोर इतिहास",
  "Score impact: +successful verifications, -tamper incidents": "स्कोर प्रभाव: +सफल सत्यापन, -छेड़छाड़ घटनाएं",
  "Search events": "इवेंट खोजें",
  "Search title, recipient, or document ID": "शीर्षक, प्राप्तकर्ता, या दस्तावेज आईडी खोजें",
  Select: "चयन करें",
  "Select a PDF to continue.": "जारी रखने के लिए PDF चुनें।",
  "Select a PDF file": "एक PDF फाइल चुनें",
  "Select an audit row below to enable targeted downloads.": "लक्षित डाउनलोड के लिए नीचे से एक ऑडिट पंक्ति चुनें।",
  Selected: "चयनित",
  "Selected Audit Entry Actions": "चयनित ऑडिट एंट्री कार्रवाइयां",
  "Selected entry QR": "चयनित एंट्री QR",
  Seq: "क्रम",
  "Signature / Hash Summary": "हस्ताक्षर / हैश सारांश",
  "Signature type": "हस्ताक्षर प्रकार",
  "Signing fingerprint": "हस्ताक्षर फिंगरप्रिंट",
  Size: "आकार",
  "Snapshot Export Error": "स्नैपशॉट निर्यात त्रुटि",
  "Something went wrong": "कुछ गलत हुआ",
  "Status System": "स्थिति प्रणाली",
  "Step 1: Document Metadata": "चरण 1: दस्तावेज मेटाडेटा",
  "Step 2: PDF Upload": "चरण 2: PDF अपलोड",
  "Step 3: Verification Setup Review": "चरण 3: सत्यापन सेटअप समीक्षा",
  "Step 4: QR Placement + Signature Review": "चरण 4: QR प्लेसमेंट + हस्ताक्षर समीक्षा",
  "Step 5: Complete": "चरण 5: पूर्ण",
  "Successful verification contribution": "सफल सत्यापन योगदान",
  Superseded: "प्रतिस्थापित",
  "Supported Files": "समर्थित फाइलें",
  "Suspicious Attempts": "संदिग्ध प्रयास",
  "Tamper Overlay Error": "छेड़छाड़ ओवरले त्रुटि",
  "Tamper Overlay Preview": "छेड़छाड़ ओवरले पूर्वावलोकन",
  "Tamper highlights for page": "पेज के लिए छेड़छाड़ हाइलाइट",
  "Tampered Attempts": "छेड़छाड़ प्रयास",
  "Tampered Sections": "छेड़छाड़ वाले सेक्शन",
  "Text Layer": "टेक्स्ट लेयर",
  Time: "समय",
  "Time Zone": "समय क्षेत्र",
  Timestamp: "टाइमस्टैम्प",
  "Total Attempts": "कुल प्रयास",
  "Total Entries": "कुल एंट्रियां",
  "Total Events": "कुल इवेंट्स",
  Trend: "रुझान",
  "Triggered by": "ट्रिगर द्वारा",
  "Trust Error": "ट्रस्ट त्रुटि",
  "Trust timeline is generated after baseline activity.": "ट्रस्ट टाइमलाइन आधार गतिविधि के बाद बनती है।",
  Type: "प्रकार",
  "Unauthorized access": "अनधिकृत पहुंच",
  Unknown: "अज्ञात",
  Updated: "अपडेट किया गया",
  Upload: "अपलोड",
  "Upload PDF for Verification": "सत्यापन के लिए PDF अपलोड करें",
  "Upload a PDF to generate the placement preview.": "प्लेसमेंट पूर्वावलोकन बनाने के लिए PDF अपलोड करें।",
  "Use original PDF exports to reduce parsing mismatches.": "पार्सिंग mismatch कम करने के लिए मूल PDF export उपयोग करें।",
  "Validation Feedback": "सत्यापन प्रतिक्रिया",
  "Verification Contact Email": "सत्यापन संपर्क ईमेल",
  "Verification Error": "सत्यापन त्रुटि",
  "Verification Events": "सत्यापन इवेंट्स",
  "Verification Findings": "सत्यापन निष्कर्ष",
  "Verification History": "सत्यापन इतिहास",
  "Verification Setup Review": "सत्यापन सेटअप समीक्षा",
  "Verification Tips": "सत्यापन सुझाव",
  "Verification token preview": "सत्यापन टोकन पूर्वावलोकन",
  "Verification volume contribution": "सत्यापन मात्रा योगदान",
  "Verified At": "सत्यापित समय",
  "Verified Attempts": "सत्यापित प्रयास",
  "Verified, Tampered, Suspicious, Revoked, and Not Found states.": "सत्यापित, छेड़छाड़, संदिग्ध, रद्द और नहीं मिला अवस्थाएं।",
  Verify: "सत्यापित करें",
  "Verify Chain": "चेन सत्यापित करें",
  "Verify Document": "दस्तावेज सत्यापित करें",
  "Verifying QR...": "QR सत्यापित हो रहा है...",
  "Verifying Upload...": "अपलोड सत्यापित हो रहा है...",
  Version: "संस्करण",
  "Version Chain": "संस्करण श्रृंखला",
  "Visual Layer": "दृश्य लेयर",
  "Visual diff peak": "दृश्य अंतर शिखर",
  "Visual preview appears for upload verification results in the same session. For QR-only verification there is no uploaded file preview.": "उसी सत्र में अपलोड सत्यापन परिणाम के लिए दृश्य पूर्वावलोकन दिखाई देता है। केवल QR सत्यापन में अपलोड फाइल पूर्वावलोकन नहीं होता।",
  "Waiting for PDF upload": "PDF अपलोड की प्रतीक्षा",
  Warning: "चेतावनी",
  "Your role does not allow this operation.": "आपकी भूमिका इस कार्रवाई की अनुमति नहीं देती।",
  changes: "परिवर्तन",
  "contains detector evidence": "डिटेक्टर साक्ष्य मौजूद है",
  "flagged by visual diff without box geometry": "बॉक्स ज्योमेट्री के बिना visual diff द्वारा चिह्नित",
  "from latest event": "नवीनतम इवेंट से",
  "impacted page(s)": "प्रभावित पेज",
  "visual diff flagged": "visual diff द्वारा चिह्नित",
}

const HI_FALLBACK_PHRASES = {
  "No records match current filters.": "वर्तमान फिल्टर से कोई रिकॉर्ड मेल नहीं खाता।",
  "PDF only. Embedded images and scanned documents are supported.": "केवल PDF। एम्बेडेड इमेज और स्कैन दस्तावेज समर्थित हैं।",
  "Every issuance and verification event is chained by sequence, previous hash, and current hash for traceable evidence.": "हर जारीकरण और सत्यापन इवेंट क्रम, पिछले हैश और वर्तमान हैश से जुड़ा है।",
}

const HI_FALLBACK_TERMS = {
  Download: "डाउनलोड",
  Upload: "अपलोड",
  Verify: "सत्यापित",
  Verification: "सत्यापन",
  Document: "दस्तावेज",
  Documents: "दस्तावेज",
  Profile: "प्रोफाइल",
  Error: "त्रुटि",
  Result: "परिणाम",
  Results: "परिणाम",
  Status: "स्थिति",
  Trust: "ट्रस्ट",
  Score: "स्कोर",
  Activity: "गतिविधि",
  Audit: "ऑडिट",
  Metadata: "मेटाडेटा",
  Signature: "हस्ताक्षर",
  Hash: "हैश",
  Issued: "जारी",
  Issuer: "जारीकर्ता",
  Recipient: "प्राप्तकर्ता",
  Reason: "कारण",
  History: "इतिहास",
  Action: "कार्रवाई",
  Time: "समय",
  Date: "तिथि",
  Page: "पेज",
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function applyHindiFallback(value) {
  if (typeof value !== "string" || !value.trim()) return value

  let result = value
  Object.entries(HI_FALLBACK_PHRASES).forEach(([source, translated]) => {
    result = result.replace(new RegExp(escapeRegExp(source), "gi"), translated)
  })

  Object.entries(HI_FALLBACK_TERMS).forEach(([source, translated]) => {
    result = result.replace(new RegExp(`\\b${escapeRegExp(source)}\\b`, "gi"), translated)
  })

  return result
}

function getInitialLanguage() {
  if (typeof window === "undefined") return "en"

  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  if (saved === "hi" || saved === "en") return saved

  return window.navigator.language?.toLowerCase().startsWith("hi") ? "hi" : "en"
}

function getInitialTheme() {
  if (typeof window === "undefined") return "light"

  const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (saved === "dark" || saved === "light") return saved

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme)

  const setTheme = (nextTheme) => {
    setThemeState(nextTheme)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    }
  }

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark")
  }

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    }
  }, [theme])

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage)

  const setLanguage = (nextLanguage) => {
    setLanguageState(nextLanguage)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
    }
  }

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language
    }
  }, [language])

  const t = (value) => {
    if (language !== "hi") return value
    if (HI_TRANSLATIONS[value]) return HI_TRANSLATIONS[value]
    return applyHindiFallback(value)
  }

  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  return useContext(LanguageContext)
}

export function useTheme() {
  return useContext(ThemeContext)
}
