export function prepareSpeechText(input) {
  let text = String(input ?? "");
  text = text
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, " ")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bAap\b/gi, "आप")
    .replace(/\bJOMY\b/gi, "जोमी");
  // Convert a conservative set of common Roman-Hindi words so Hindi replies
  // are spoken with Hindi phonetics instead of an English-letter accent.
  const romanHindi = {
    namaste: "नमस्ते", mujhe: "मुझे", batao: "बताओ", aaj: "आज",
    tum: "तुम", kaise: "कैसे", ho: "हो", hain: "हैं", hai: "है",
    main: "मैं", mein: "में", mera: "मेरा", meri: "मेरी", mere: "मेरे",
    aap: "आप", ap: "आप", kya: "क्या", kyun: "क्यों", kyon: "क्यों",
    kahan: "कहाँ", kab: "कब", ka: "का", ki: "की", ke: "के",
    ko: "को", se: "से", par: "पर", aur: "और", ya: "या",
    nahi: "नहीं", nahin: "नहीं", haan: "हाँ", han: "हाँ",
    achha: "अच्छा", accha: "अच्छा", bahut: "बहुत", pyara: "प्यारा",
    pyaari: "प्यारी", sundar: "सुंदर", shukriya: "शुक्रिया",
    dhanyavaad: "धन्यवाद", khushi: "खुशी", milkar: "मिलकर",
    boliye: "बोलिए", suno: "सुनो", sun: "सुन", karo: "करो",
    kar: "कर", karna: "करना", chahiye: "चाहिए", abhi: "अभी",
    phir: "फिर", fir: "फिर", kal: "कल", yahan: "यहाँ",
    wahan: "वहाँ", saath: "साथ", dost: "दोस्त", pyaar: "प्यार",
    dil: "दिल", aapka: "आपका", aapki: "आपकी", aapke: "आपके",
    tumhara: "तुम्हारा", tumhari: "तुम्हारी", tumhare: "तुम्हारे",
    hoon: "हूँ", hun: "हूँ", tha: "था", thi: "थी", the: "थे"
  };
  text = text.replace(/\b[A-Za-z]+\b/g, (word) => romanHindi[word.toLowerCase()] || word);

  // Remove emoji presentation/keycap joiners before applying the speech allowlist.
  text = text
    .replace(/[#*0-9]\uFE0F?\u20E3/gu, " ")
    .replace(/[\uFE0E\uFE0F\u200D\u20E3]/gu, " ");

  // Keep only spoken words, numbers and natural pause punctuation.
  // URLs, code, emoji and decorative symbols are not spoken.
  const cleaned = text
    .replace(/[^\p{L}\p{N}\p{M}\s,.;?!।]/gu, " ")
    .replace(/[!?]{2,}/gu, "!")
    .replace(/\.{2,}/gu, ".")
    .replace(/[,;]{2,}/gu, ",")
    .replace(/\s+([,.;?!।])/gu, "$1")
    .replace(/([,;?!।])(?=\S)/gu, "$1 ")
    .replace(/\s+/gu, " ")
    .trim();

  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}
