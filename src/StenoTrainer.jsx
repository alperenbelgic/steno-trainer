import { useState, useEffect, useCallback, useRef } from "react";
import lapwingData from "../lapwing-base.json";
import sentences from "../sentences.json";

// Parse a steno stroke string into individual key names used by the keyboard
// e.g. "TP-R" → ["T-", "P-", "-R"]
// e.g. "TRAO" → ["T-", "R-", "A", "O"]
// e.g. "PW*ET" → ["P-", "W-", "*", "E", "-T"]
function parseStroke(stroke) {
  const VOWELS = new Set(['A', 'O', 'E', 'U']);
  const keys = [];
  let rightSide = false;
  let seenVowelOrStar = false;

  for (const ch of stroke) {
    if (ch === '#') {
      keys.push('#');
    } else if (ch === '-') {
      rightSide = true;
    } else if (ch === '*') {
      keys.push('*');
      seenVowelOrStar = true;
    } else if (VOWELS.has(ch)) {
      keys.push(ch);
      seenVowelOrStar = true;
    } else if (seenVowelOrStar || rightSide) {
      keys.push('-' + ch);
    } else {
      keys.push(ch + '-');
    }
  }

  return keys;
}

// Build WORD_MAP from lapwing-base.json format { stroke: translation }
// Result: { word: { word, strokes[], stenoKeys[][], cumulativePrefixOutputs[] } }
// Multi-stroke entries (e.g. "SEUS/TE/PHA/TEUBG") are supported.
// cumulativePrefixOutputs[i] = expected text in input field after stroke i.
//   - For single-stroke words: [word]
//   - For multi-stroke words from the JSON dictionary, intermediate outputs
//     are unknown (would require running Plover's translator), so they
//     default to null and the trainer accepts any output for those positions.
//     The final entry is always the full word. Override via setOverride() if
//     you have ground-truth intermediate outputs.
function buildWordMap(json) {
  const wordMap = Object.create(null);
  for (const [strokeStr, translation] of Object.entries(json)) {
    if (typeof translation !== 'string') continue;
    if (translation.includes('{') || translation.includes('=') ||
        translation.includes('\t') || translation.includes(' ')) continue; // formatted/phrases
    const word = translation.toLowerCase();
    if (!word || !/^[a-z']+$/.test(word)) continue;             // digits, symbols, etc.

    const strokes = strokeStr.split('/');
    const stenoKeys = strokes.map(parseStroke);
    const cumulativePrefixOutputs = strokes.map((_, i) =>
      i === strokes.length - 1 ? word : null
    );

    // Prefer the entry with fewest strokes when duplicates exist.
    const existing = wordMap[word];
    if (!existing || strokes.length < existing.strokes.length) {
      wordMap[word] = { word, strokes, stenoKeys, cumulativePrefixOutputs };
    }
  }
  return wordMap;
}

const WORD_MAP = buildWordMap(lapwingData);

function stripWord(w) { return w.toLowerCase().replace(/[^a-z']/g, ''); }

function formatDuration(seconds) {
  if (!seconds) return "0s";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

function debugLog(event, payload = {}) {
  try {
    console.log(`[steno] ${event} ${JSON.stringify(payload)}`);
  } catch {
    console.log(`[steno] ${event} ${String(payload)}`);
  }
}

const COMPLETION_STORAGE_KEY = "stenoTrainer.drillCompletions.v1";

function saveDrillCompletion(entry) {
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    const existing = JSON.parse(
      window.localStorage.getItem(COMPLETION_STORAGE_KEY) || "[]"
    );
    const completions = Array.isArray(existing) ? existing : [];
    completions.push(entry);
    window.localStorage.setItem(COMPLETION_STORAGE_KEY, JSON.stringify(completions));
    debugLog("drill completion saved", entry);
  } catch (error) {
    debugLog("drill completion save failed", {message: error?.message});
  }
}

function loadDrillCompletions() {
  if (typeof window === "undefined" || !window.localStorage) return [];

  try {
    const completions = JSON.parse(
      window.localStorage.getItem(COMPLETION_STORAGE_KEY) || "[]"
    );
    return Array.isArray(completions) ? completions : [];
  } catch (error) {
    debugLog("drill completions load failed", {message: error?.message});
    return [];
  }
}

function getDrillStats(drillName) {
  const completions = loadDrillCompletions().filter(
    (entry) => entry?.drillName === drillName
  );
  const totalWpm = completions.reduce(
    (total, entry) => total + (Number(entry.wpm) || 0),
    0
  );
  const totalCompletionSeconds = completions.reduce(
    (total, entry) => total + (Number(entry.elapsedSeconds) || 0),
    0
  );
  const fastestWpm = completions.reduce(
    (fastest, entry) => Math.max(fastest, Number(entry.wpm) || 0),
    0
  );
  const completionSeconds = completions
    .map((entry) => Number(entry.elapsedSeconds) || 0)
    .filter((seconds) => seconds > 0);

  return {
    runs: completions.length,
    averageWpm: completions.length ? Math.round(totalWpm / completions.length) : 0,
    fastestWpm,
    averageCompletionSeconds: completions.length
      ? Math.round(totalCompletionSeconds / completions.length)
      : 0,
    fastestCompletionSeconds: completionSeconds.length
      ? Math.min(...completionSeconds)
      : 0,
  };
}

function buildDrillItems(items) {
  let sectionTitle = "";
  return items.reduce((drills, item) => {
    if (typeof item.title === "string") {
      sectionTitle = item.title;
      return drills;
    }

    if (typeof item.content !== "string") return drills;
    drills.push({...item, sectionTitle});
    return drills;
  }, []);
}

const DRILL_ITEMS = buildDrillItems(sentences);
const SENTENCES = DRILL_ITEMS.map((sentence) => sentence.content);
const HINT_MODES = {
  ALWAYS: "always",
  AFTER_FAIL: "after-fail",
  NEVER: "never",
};
const HINT_OPTIONS = [
  { value: HINT_MODES.ALWAYS, label: "Always" },
  { value: HINT_MODES.AFTER_FAIL, label: "After mistake" },
  { value: HINT_MODES.NEVER, label: "Off" },
];

function normalizeSentenceName(name) {
  return name.trim().toLowerCase();
}

function getSentenceIndexByName(name) {
  if (!name) return -1;
  const normalizedName = normalizeSentenceName(name);
  return DRILL_ITEMS.findIndex(
    (sentence) =>
      typeof sentence.name === "string" &&
      normalizeSentenceName(sentence.name) === normalizedName
  );
}

function getSentenceName(index) {
  return DRILL_ITEMS[index]?.name || `Drill ${index + 1}`;
}

function getSentencePath(index) {
  const slug = getSentenceName(index).trim().replace(/\s+/g, "_");
  return `${import.meta.env.BASE_URL}${encodeURIComponent(slug)}`;
}

function getUrlSentenceName() {
  if (typeof window === "undefined") return "";
  const basePath = import.meta.env.BASE_URL;
  const pathname = window.location.pathname;
  const basePathWithoutTrailingSlash = basePath.replace(/\/$/, "");
  const relativePath = pathname === basePathWithoutTrailingSlash
    ? ""
    : pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname.replace(/^\/+/, "");
  const segment = relativePath.split("/").filter(Boolean)[0];
  if (!segment) return "";

  try {
    return decodeURIComponent(segment).replace(/_/g, " ");
  } catch {
    return segment.replace(/_/g, " ");
  }
}

function getUrlSentenceIndex() {
  return getSentenceIndexByName(getUrlSentenceName());
}

const INITIAL_SENTENCE_INDEX = Math.max(0, getUrlSentenceIndex());

function getSentenceRawStenoMode(index) {
  return DRILL_ITEMS[index]?.rawSteno === true;
}

const FINGER_COLORS = {
  lp:"#e06c75",lr:"#e5c07b",lm:"#61afef",li:"#c678dd",
  lt:"#56b6c2",rt:"#56b6c2",ri:"#c678dd",rm:"#61afef",
  rr:"#e5c07b",rp:"#e06c75",
};
const FINGER_LABELS = [
  {id:"lp",label:"L Pinky"},{id:"lr",label:"L Ring"},{id:"lm",label:"L Mid"},
  {id:"li",label:"L Index"},{id:"lt",label:"L Thumb"},{id:"rt",label:"R Thumb"},
  {id:"ri",label:"R Index"},{id:"rm",label:"R Mid"},{id:"rr",label:"R Ring"},
  {id:"rp",label:"R Pinky"},
];

const UNI_ROWS = [
  [{id:"#",label:"#",finger:"lp"},{id:"T-",label:"T",finger:"lr"},{id:"P-",label:"P",finger:"lm"},{id:"H-",label:"H",finger:"li"},{id:"*1",label:"*",finger:"li",dim:true},null,{id:"*2",label:"*",finger:"ri",dim:true},{id:"-F",label:"F",finger:"ri"},{id:"-P",label:"P",finger:"rm"},{id:"-L",label:"L",finger:"rr"},{id:"-T",label:"T",finger:"rp"},{id:"-D",label:"D",finger:"rp"}],
  [{id:"S-",label:"S",finger:"lp"},{id:"K-",label:"K",finger:"lr"},{id:"W-",label:"W",finger:"lm"},{id:"R-",label:"R",finger:"li"},{id:"*3",label:"*",finger:"li",dim:true},null,{id:"*4",label:"*",finger:"ri",dim:true},{id:"-R",label:"R",finger:"ri"},{id:"-B",label:"B",finger:"rm"},{id:"-G",label:"G",finger:"rr"},{id:"-S",label:"S",finger:"rp"},{id:"-Z",label:"Z",finger:"rp"}],
  [null,null,{id:"#1",label:"#",finger:"lt",dim:true},{id:"A",label:"A",finger:"lt"},{id:"O",label:"O",finger:"lt"},null,{id:"E",label:"E",finger:"rt"},{id:"U",label:"U",finger:"rt"},{id:"#2",label:"#",finger:"rt",dim:true},null,null,null],
];

const STENO_TO_UNI = {
  "S-":["S-"],"T-":["T-"],"K-":["K-"],"P-":["P-"],
  "W-":["W-"],"H-":["H-"],"R-":["R-"],
  "*":["*1","*2","*3","*4"],
  "A":["A"],"O":["O"],"E":["E"],"U":["U"],
  "-F":["-F"],"-R":["-R"],"-P":["-P"],"-B":["-B"],
  "-L":["-L"],"-G":["-G"],"-T":["-T"],"-S":["-S"],"-D":["-D"],"-Z":["-Z"],
};

function getActiveUniKeys(stenoKeys){
  const ids=new Set();
  stenoKeys.forEach(sk=>{const m=STENO_TO_UNI[sk];if(m)m.forEach(id=>ids.add(id));});
  return ids;
}

function Key({data,active,showFingers}){
  if(!data)return <div style={{width:48,height:48,margin:2}}/>;
  const fc=FINGER_COLORS[data.finger]||"#888";
  let bg="var(--key-bg)",border="var(--key-border)",color=data.dim?"#555":"var(--key-text)";
  let shadow="0 1px 0 var(--key-shadow)";
  if(active){bg=`${fc}45`;border=fc;color="var(--hl-text)";shadow=`0 2px 0 ${fc}80`;}
  return(<div style={{width:48,height:48,borderRadius:8,background:bg,border:`2px solid ${border}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",boxShadow:showFingers?`0 2px 0 ${fc}, ${shadow}`:`${shadow}`,transition:"all 0.08s ease",cursor:"default",userSelect:"none",margin:2}}>
    <span style={{fontSize:14,fontWeight:700,lineHeight:1,color,opacity:data.dim&&!active?0.4:1}}>{showFingers?data.label:null}</span>
  </div>);
}

function UniKeyboard({activeKeys,showFingers}){
  const a=activeKeys;
  return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
    {UNI_ROWS.map((row,ri)=>(<div key={ri} style={{display:"flex",gap:0}}>
      {row.map((kd,ki)=>(<Key key={`${ri}-${ki}`} data={kd} active={kd&&a.has(kd.id)} showFingers={showFingers}/>))}
    </div>))}
  </div>);
}

export default function StenoTrainer(){
  const[si,setSi]=useState(INITIAL_SENTENCE_INDEX);
  const[wi,setWi]=useState(0);
  const[strokeIndex,setStrokeIndex]=useState(0);
  const[hintMode,setHintMode]=useState(HINT_MODES.AFTER_FAIL);
  const[showFingers,setShowFingers]=useState(true);
  const[rawStenoMode,setRawStenoMode]=useState(() => getSentenceRawStenoMode(INITIAL_SENTENCE_INDEX));
  const[fb,setFb]=useState(null);
  const[hintRevealed,setHintRevealed]=useState(false);
  const[correct,setCorrect]=useState(0);
  const[attempts,setAttempts]=useState(0);
  const[sessionStarted,setSessionStarted]=useState(false);
  const[elapsedSeconds,setElapsedSeconds]=useState(0);
  const[showDrills,setShowDrills]=useState(true);
  const[showConfig,setShowConfig]=useState(true);
  const[showStats,setShowStats]=useState(false);
  const[statsRefresh,setStatsRefresh]=useState(0);
  const inputRef=useRef(null);
  const fbRef=useRef(null);
  const settleRef=useRef(null);
  const wordStartOffsetRef=useRef(0);
  const strokeIndexRef=useRef(0);
  const pendingAdvanceRef=useRef(false);
  const pointerDownRef=useRef(false);
  const sessionStartRef=useRef(null);
  const correctRef=useRef(0);
  const attemptsRef=useRef(0);
  const sentenceIndexRef=useRef(INITIAL_SENTENCE_INDEX);
  const wordIndexRef=useRef(0);
  const wordsLengthRef=useRef(0);
  const renderCountRef=useRef(0);
  renderCountRef.current+=1;

  const sentence=SENTENCES[si]||SENTENCES[0];
  const words=sentence.split(" ");
  sentenceIndexRef.current=si;
  wordIndexRef.current=wi;
  wordsLengthRef.current=words.length;
  const sentenceComplete=wi>=words.length;
  const curStr=sentenceComplete?"":words[wi];
  const curData=curStr
    ? rawStenoMode
      ? {word:curStr,strokes:[curStr],stenoKeys:[parseStroke(curStr)],cumulativePrefixOutputs:[curStr]}
      : WORD_MAP[stripWord(curStr)]
    : null;

  // Keep latest curData accessible inside debounced callback without stale closure.
  const curDataRef=useRef(curData);
  useEffect(()=>{curDataRef.current=curData;},[curData]);

  useEffect(()=>{
    debugLog("render",{
      count:renderCountRef.current,
      sentenceIndex:si,
      sentenceName:getSentenceName(si),
      wordIndex:wi,
      word:curStr,
      rawStenoMode,
      hintMode,
          showDrills,
          showConfig,
          showStats,
          statsRefresh,
          sentenceComplete,
          sessionStarted,
          elapsedSeconds,
    });
  });

  useEffect(()=>{
    setRawStenoMode(getSentenceRawStenoMode(si));
  },[si]);

  useEffect(()=>{
    if(!sessionStarted||!sessionStartRef.current)return;

    const updateElapsed=()=>{
      setElapsedSeconds(Math.floor((Date.now()-sessionStartRef.current)/1000));
    };

    updateElapsed();
    if(sentenceComplete)return;

    const timer=setInterval(updateElapsed,1000);
    return()=>clearInterval(timer);
  },[sessionStarted,sentenceComplete]);

  useEffect(()=>{
    const handlePopState=()=>{
      const index=getUrlSentenceIndex();
      if(index===-1)return;
      setSi(index);
      setWi(0);
      setCorrect(0);
      setAttempts(0);
      correctRef.current=0;
      attemptsRef.current=0;
      setSessionStarted(false);
      setElapsedSeconds(0);
      sessionStartRef.current=null;
      setFb(null);
      if(inputRef.current)wordStartOffsetRef.current=inputRef.current.value.length;
    };
    window.addEventListener("popstate",handlePopState);
    return()=>window.removeEventListener("popstate",handlePopState);
  },[]);

  const advance=useCallback(()=>{
    setWi(prev=>{
      if(prev+1>=sentence.split(" ").length){
        debugLog("advance",{
          reason:"sentence complete",
          sentenceIndex:si,
          sentenceName:getSentenceName(si),
        });
        pendingAdvanceRef.current=false;
        return sentence.split(" ").length;
      }
      return prev+1;
    });
  },[sentence]);

  const advR=useRef(advance);advR.current=advance;

  // Reset per-word state whenever the current word changes.
  // Input field is NOT cleared (clearing causes Plover to replay output).
  // Instead we move the offset to the current end of the input value;
  // everything typed from now on belongs to the new word.
  useEffect(()=>{
    strokeIndexRef.current=0;
    setStrokeIndex(0);
    setHintRevealed(false);
    pendingAdvanceRef.current=false;
    const offset=inputRef.current?inputRef.current.value.length:0;
    wordStartOffsetRef.current=offset;
    debugLog("word change",{
      sentenceIndex:si,
      wordIndex:wi,
      word:curStr,
      strokes:curData?.strokes,
      cumulativePrefixOutputs:curData?.cumulativePrefixOutputs,
      newOffset:offset,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[si,wi]);

  // Evaluate one stroke. Called debounced after Plover finishes emitting
  // the keystrokes for a single chord.
  const evaluateStroke=useCallback(()=>{
    if(!inputRef.current)return;
    if(pendingAdvanceRef.current)return;
    const data=curDataRef.current;
    if(!data){debugLog("stroke", {reason:"no data for current word"});return;}
    const fullValue=inputRef.current.value;
    const currentOutput=fullValue.substring(wordStartOffsetRef.current);

    const prev=strokeIndexRef.current;
    const isLast=prev>=data.strokes.length-1;
    const expected=data.cumulativePrefixOutputs[prev];
    const normalized=currentOutput.trim().toLowerCase();
    const matches=expected==null?true:normalized===expected.toLowerCase();

    debugLog("stroke",{
      word:data.word,
      strokeIndex:prev,
      stroke:data.strokes[prev],
      currentOutput,
      normalized,
      expected,
      matches,
      isLast,
      offset:wordStartOffsetRef.current,
    });

    if(isLast){
      if(matches){
        pendingAdvanceRef.current=true; // synchronous — blocks any re-entrant calls
        const nextAttempts=attemptsRef.current+1;
        const nextCorrect=correctRef.current+1;
        attemptsRef.current=nextAttempts;
        correctRef.current=nextCorrect;
        setFb("correct");
        setAttempts(nextAttempts);
        setCorrect(nextCorrect);
        wordStartOffsetRef.current=fullValue.length;
        strokeIndexRef.current=0;
        setStrokeIndex(0);
        debugLog("word complete",{word:data.word,finalOutput:currentOutput});
        if(wordIndexRef.current+1>=wordsLengthRef.current){
          const drillIndex=sentenceIndexRef.current;
          const elapsed=sessionStartRef.current
            ?Math.floor((Date.now()-sessionStartRef.current)/1000)
            :0;
          const accuracy=nextAttempts>0?Math.round(nextCorrect/nextAttempts*100):0;
          const completedWords=wordsLengthRef.current;
          const completionWpm=elapsed>0?Math.round(completedWords/(elapsed/60)):0;
          saveDrillCompletion({
            drillName:getSentenceName(drillIndex),
            sectionTitle:DRILL_ITEMS[drillIndex]?.sectionTitle || "",
            completedAt:new Date().toISOString(),
            elapsedSeconds:elapsed,
            wpm:completionWpm,
            accuracy,
            correct:nextCorrect,
            attempts:nextAttempts,
            completedWords,
            rawSteno:DRILL_ITEMS[drillIndex]?.rawSteno === true,
          });
          setStatsRefresh(v=>v+1);
        }
        setTimeout(()=>{setFb(null);setHintRevealed(false);advR.current();},0);
      } else {
        // Wrong word typed — flash error, reset so they try the whole word again.
        const nextAttempts=attemptsRef.current+1;
        attemptsRef.current=nextAttempts;
        debugLog("word wrong",{word:data.word,normalized,expected});
        setHintRevealed(true);
        setFb("wrong");
        setAttempts(nextAttempts);
        if(fbRef.current)clearTimeout(fbRef.current);
        fbRef.current=setTimeout(()=>setFb(null),400);
        wordStartOffsetRef.current=fullValue.length;
        strokeIndexRef.current=0;
        setStrokeIndex(0);
      }
      return;
    }

    if(!matches){
      // Intermediate stroke mismatch — flag it but keep accepting strokes
      // since we can't undo what Plover already emitted.
      debugLog("stroke wrong",{reason:"intermediate mismatch"});
      const nextAttempts=attemptsRef.current+1;
      attemptsRef.current=nextAttempts;
      setHintRevealed(true);
      setFb("wrong");
      setAttempts(nextAttempts);
      if(fbRef.current)clearTimeout(fbRef.current);
      fbRef.current=setTimeout(()=>setFb(null),300);
    }
    strokeIndexRef.current=prev+1;
    setStrokeIndex(prev+1);
  },[]);

  const startSession=useCallback(()=>{
    if(sessionStartRef.current||sentenceComplete)return;
    sessionStartRef.current=Date.now();
    setElapsedSeconds(0);
    setSessionStarted(true);
    debugLog("session start",{
      sentenceIndex:si,
      sentenceName:getSentenceName(si),
    });
  },[sentenceComplete,si]);

  const handleInput=useCallback((e)=>{
    startSession();
    debugLog("input",{
      value:e.target.value,
      length:e.target.value.length,
      offset:wordStartOffsetRef.current,
      slice:e.target.value.substring(wordStartOffsetRef.current),
    });
    // Coalesce the keystroke burst Plover emits per chord into one stroke event.
    if(settleRef.current)clearTimeout(settleRef.current);
    settleRef.current=setTimeout(()=>evaluateStroke(),50);
  },[evaluateStroke,startSession]);

  useEffect(()=>{
    const h=(e)=>{
      if(e.key==="Enter"){
        e.preventDefault();
        if(fbRef.current)clearTimeout(fbRef.current);
        if(settleRef.current)clearTimeout(settleRef.current);
        setFb(null);
        // Move offset past whatever's currently in the field so next word
        // starts fresh from Plover's perspective.
        if(inputRef.current)wordStartOffsetRef.current=inputRef.current.value.length;
        debugLog("skip",{key:"Enter",reason:"manual advance"});
        advR.current();
      }
    };
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[]);

  useEffect(()=>{
    const handlePointerDown=()=>{pointerDownRef.current=true;};
    const handlePointerUp=()=>{pointerDownRef.current=false;};
    window.addEventListener("pointerdown",handlePointerDown);
    window.addEventListener("pointerup",handlePointerUp);
    window.addEventListener("blur",handlePointerUp);

    const iv=setInterval(()=>{
      const selection=document.getSelection();
      const hasTextSelection=selection&&selection.type==="Range";
      const activeTag=document.activeElement?.tagName;
      const activeElementIsControl=["BUTTON","INPUT","SELECT","TEXTAREA"].includes(activeTag);
      const shouldSkipFocus=pointerDownRef.current||hasTextSelection||activeElementIsControl;
      if(inputRef.current&&document.activeElement!==inputRef.current&&!shouldSkipFocus){
        inputRef.current.focus({preventScroll:true});
        debugLog("focus hidden input",{
          previousActiveTag:activeTag||null,
          hasTextSelection:!!hasTextSelection,
          pointerDown:pointerDownRef.current,
        });
      }
    },200);
    return()=>{
      clearInterval(iv);
      window.removeEventListener("pointerdown",handlePointerDown);
      window.removeEventListener("pointerup",handlePointerUp);
      window.removeEventListener("blur",handlePointerUp);
    };
  },[]);

  const completedWords=Math.min(wi,words.length);
  const wpm=elapsedSeconds>0?Math.round(completedWords/(elapsedSeconds/60)):0;
  const acc=attempts>0?Math.round(correct/attempts*100):0;
  const drillStats=getDrillStats(getSentenceName(si));
  const currentStrokeKeys=curData&&strokeIndex<curData.strokes.length
    ?curData.stenoKeys[strokeIndex]
    :null;
  const activeUni=currentStrokeKeys?getActiveUniKeys(currentStrokeKeys):new Set();
  const showHints=hintMode!==HINT_MODES.NEVER&&(hintMode===HINT_MODES.ALWAYS||hintRevealed);

  const getStenoKeyColor=(sk)=>{
    const m=STENO_TO_UNI[sk];if(!m)return"var(--text-dim)";
    const kd=UNI_ROWS.flat().find(k=>k&&k.id===m[0]);
    return kd?FINGER_COLORS[kd.finger]:"var(--text-dim)";
  };

  const focusTrainerInput=()=>{
    requestAnimationFrame(()=>{
      inputRef.current?.focus({preventScroll:true});
    });
  };

  const resetSession=()=>{
    if(fbRef.current)clearTimeout(fbRef.current);
    if(settleRef.current)clearTimeout(settleRef.current);
    setWi(0);
    setStrokeIndex(0);
    setHintRevealed(false);
    setFb(null);
    setCorrect(0);
    setAttempts(0);
    correctRef.current=0;
    attemptsRef.current=0;
    setSessionStarted(false);
    setElapsedSeconds(0);
    sessionStartRef.current=null;
    pendingAdvanceRef.current=false;
    strokeIndexRef.current=0;
    if(inputRef.current)wordStartOffsetRef.current=inputRef.current.value.length;
  };

  const restartSession=()=>{
    resetSession();
    focusTrainerInput();
    debugLog("session restart",{
      sentenceIndex:si,
      sentenceName:getSentenceName(si),
    });
  };

  const selectSentence=(index)=>{
    window.history.pushState(null,"",getSentencePath(index));
    setSi(index);
    resetSession();
    focusTrainerInput();
  };

  return(
    <div style={{"--bg":"#0f1119","--surface":"#1a1d2e","--surface2":"#232741","--text":"#e8eaf0","--text-dim":"#7b7f96","--accent":"#4f8cff","--hl-text":"#b8d4ff","--key-bg":"#1e2235","--key-border":"#2d3250","--key-text":"#8b8faa","--key-shadow":"#0a0c14","--error":"#e5484d","--success":"#30a46c",minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'JetBrains Mono','SF Mono','Fira Code',monospace",display:"flex",flexDirection:"column",alignItems:"center",padding:"24px 16px",boxSizing:"border-box"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}`}</style>
      <div style={{position:"fixed",top:16,left:16,zIndex:20,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:8}}>
        <button type="button" onClick={()=>setShowDrills(open=>!open)} aria-expanded={showDrills} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:6,border:"1px solid var(--surface2)",background:"var(--surface)",color:"var(--text)",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 8px 24px rgba(0,0,0,0.25)"}}>
          <span aria-hidden="true" style={{fontSize:15,lineHeight:1}}>▦</span>
          <span>Drills & Tests</span>
        </button>

        {showDrills&&(
          <div style={{width:230,maxHeight:"calc(100vh - 72px)",overflowY:"auto",padding:8,borderRadius:8,border:"1px solid var(--surface2)",background:"var(--surface)",boxShadow:"0 16px 40px rgba(0,0,0,0.35)",display:"flex",flexDirection:"column",alignItems:"stretch",gap:4,fontSize:12,color:"var(--text-dim)"}}>
            {DRILL_ITEMS.map((item,idx)=>(
              <div key={getSentenceName(idx)} style={{display:"flex",flexDirection:"column",gap:4}}>
                {item.sectionTitle&&item.sectionTitle!==DRILL_ITEMS[idx-1]?.sectionTitle&&(
                  <div style={{padding:"10px 10px 4px",fontSize:11,fontWeight:800,color:"var(--text)",textTransform:"uppercase",letterSpacing:0}}>
                    {item.sectionTitle}
                  </div>
                )}
                <button type="button" onClick={()=>selectSentence(idx)} style={{padding:"8px 10px",borderRadius:6,border:"1px solid transparent",background:idx===si?"var(--surface2)":"transparent",color:idx===si?"var(--text)":"var(--text-dim)",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:idx===si?700:400,textAlign:"left",lineHeight:1.35}}>
                  {item.name || `Drill ${idx+1}`}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{position:"fixed",top:16,right:16,zIndex:20,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
        <button type="button" onClick={()=>setShowConfig(open=>!open)} aria-expanded={showConfig} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:6,border:"1px solid var(--surface2)",background:"var(--surface)",color:"var(--text)",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 8px 24px rgba(0,0,0,0.25)"}}>
          <span aria-hidden="true" style={{fontSize:15,lineHeight:1}}>⚙</span>
          <span>Configuration</span>
        </button>

        {showConfig&&(
          <div style={{width:220,padding:12,borderRadius:8,border:"1px solid var(--surface2)",background:"var(--surface)",boxShadow:"0 16px 40px rgba(0,0,0,0.35)",display:"flex",flexDirection:"column",alignItems:"stretch",gap:12,fontSize:13,color:"var(--text-dim)"}}>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--text)",textTransform:"uppercase"}}>Hint visibility</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",padding:2,borderRadius:6,border:"1px solid var(--surface2)",background:"var(--bg)",gap:2}}>
                {HINT_OPTIONS.map((option)=>(
                  <button key={option.value} type="button" onClick={()=>{setHintMode(option.value);focusTrainerInput();}} style={{minHeight:30,padding:"4px 6px",borderRadius:4,border:"none",background:hintMode===option.value?"var(--accent)":"transparent",color:hintMode===option.value?"#fff":"var(--text-dim)",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:hintMode===option.value?700:500,lineHeight:1.15}}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}><input type="checkbox" checked={showFingers} onChange={e=>{setShowFingers(e.target.checked);focusTrainerInput();}} style={{accentColor:"var(--accent)"}}/>Finger map</label>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"not-allowed",opacity:0.6}}><input type="checkbox" checked={rawStenoMode} disabled style={{accentColor:"var(--accent)"}}/>Raw steno</label>
          </div>
        )}
      </div>

      <div style={{textAlign:"center",marginBottom:16}}>
        <h1 style={{fontSize:28,fontWeight:800,letterSpacing:-1,background:"linear-gradient(135deg,#4f8cff,#a78bfa)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>STENO TRAINER</h1>
        <p style={{fontSize:12,color:"var(--text-dim)",marginTop:4}}>Uni v4 · Lapwing theory · Chord the highlighted keys · Enter to skip</p>
      </div>

      <div style={{display:"flex",alignItems:"center",gap:24,marginBottom:16,fontSize:13,color:"var(--text-dim)",flexWrap:"wrap",justifyContent:"center"}}>
        <span>Time <strong style={{color:sessionStarted?"var(--accent)":"var(--text-dim)"}}>{elapsedSeconds}s</strong></span>
        <span>WPM <strong style={{color:wpm>0?"var(--success)":"var(--text-dim)"}}>{wpm}</strong></span>
        <span>Accuracy <strong style={{color:acc>=80?"var(--success)":"var(--text-dim)"}}>{acc}%</strong></span>
        <div style={{display:"flex",gap:8}}>
          <button type="button" onClick={restartSession} style={{padding:"4px 10px",borderRadius:4,border:"1px solid var(--surface2)",background:"var(--surface)",color:"var(--text)",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Restart</button>
          <button type="button" onClick={()=>{setShowStats(true);focusTrainerInput();}} style={{padding:"4px 2px",border:"none",background:"transparent",color:"var(--accent)",cursor:"pointer",fontFamily:"inherit",fontSize:12,textDecoration:"underline"}}>Stats</button>
        </div>
      </div>

      {showStats&&(
        <div style={{position:"fixed",inset:0,zIndex:40,background:"rgba(5,7,12,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>{setShowStats(false);focusTrainerInput();}}>
          <div role="dialog" aria-modal="true" aria-label="Drill stats" onClick={e=>e.stopPropagation()} style={{width:"min(420px,100%)",padding:18,borderRadius:8,border:"1px solid var(--surface2)",background:"var(--surface)",boxShadow:"0 24px 70px rgba(0,0,0,0.45)",display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:"var(--text)"}}>Stats</div>
                <div style={{marginTop:4,fontSize:12,color:"var(--text-dim)"}}>{getSentenceName(si)}</div>
              </div>
              <button type="button" onClick={()=>{setShowStats(false);focusTrainerInput();}} style={{width:30,height:30,borderRadius:6,border:"1px solid var(--surface2)",background:"transparent",color:"var(--text-dim)",cursor:"pointer",fontFamily:"inherit",fontSize:16,lineHeight:1}}>×</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              <div style={{padding:10,borderRadius:6,background:"var(--bg)",border:"1px solid var(--surface2)"}}>
                <div style={{fontSize:11,color:"var(--text-dim)"}}>Runs</div>
                <div style={{marginTop:6,fontSize:22,fontWeight:800,color:"var(--text)"}}>{drillStats.runs}</div>
              </div>
              <div style={{padding:10,borderRadius:6,background:"var(--bg)",border:"1px solid var(--surface2)"}}>
                <div style={{fontSize:11,color:"var(--text-dim)"}}>Average WPM</div>
                <div style={{marginTop:6,fontSize:22,fontWeight:800,color:drillStats.averageWpm>0?"var(--success)":"var(--text-dim)"}}>{drillStats.averageWpm}</div>
              </div>
              <div style={{padding:10,borderRadius:6,background:"var(--bg)",border:"1px solid var(--surface2)"}}>
                <div style={{fontSize:11,color:"var(--text-dim)"}}>Fastest WPM</div>
                <div style={{marginTop:6,fontSize:22,fontWeight:800,color:drillStats.fastestWpm>0?"var(--success)":"var(--text-dim)"}}>{drillStats.fastestWpm}</div>
              </div>
              <div style={{padding:10,borderRadius:6,background:"var(--bg)",border:"1px solid var(--surface2)"}}>
                <div style={{fontSize:11,color:"var(--text-dim)"}}>Average time</div>
                <div style={{marginTop:6,fontSize:22,fontWeight:800,color:drillStats.averageCompletionSeconds>0?"var(--text)":"var(--text-dim)"}}>{formatDuration(drillStats.averageCompletionSeconds)}</div>
              </div>
              <div style={{padding:10,borderRadius:6,background:"var(--bg)",border:"1px solid var(--surface2)"}}>
                <div style={{fontSize:11,color:"var(--text-dim)"}}>Fastest time</div>
                <div style={{marginTop:6,fontSize:22,fontWeight:800,color:drillStats.fastestCompletionSeconds>0?"var(--success)":"var(--text-dim)"}}>{formatDuration(drillStats.fastestCompletionSeconds)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{marginBottom:8,padding:"10px 20px",borderRadius:8,background:"var(--surface)",border:"1px solid var(--surface2)",maxWidth:700,width:"100%",textAlign:"center",minHeight:44,display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"4px 8px"}}>
        {words.map((w,idx)=>{
          const done=idx<wi,cur=idx===wi,isFirst=idx===0,isLast=idx===words.length-1;
          const display=(isFirst?w.charAt(0).toUpperCase()+w.slice(1):w)+(isLast?".":"");
          return(<span key={idx} style={{fontSize:16,fontWeight:cur?800:400,color:done?"var(--success)":cur?"var(--text)":"var(--text-dim)",opacity:done?0.6:1,textDecoration:done?"line-through":"none",transition:"all 0.15s"}}>{display}</span>);
        })}
      </div>

      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
        <span style={{fontSize:11,color:"var(--text-dim)"}}>{si+1}/{SENTENCES.length}</span>
      </div>

      {curData&&(<div style={{marginBottom:16,textAlign:"center",minHeight:130,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:72,fontWeight:800,letterSpacing:-2,lineHeight:1,color:fb==="correct"?"var(--success)":fb==="wrong"?"var(--error)":"var(--text)",transition:"color 0.15s",textShadow:fb==="correct"?"0 0 40px rgba(48,164,108,0.3)":fb==="wrong"?"0 0 40px rgba(229,72,77,0.3)":"none"}}>
          {rawStenoMode?curStr:(wi===0?curStr.charAt(0).toUpperCase()+curStr.slice(1):curStr)+(wi===words.length-1?".":"")}
        </div>
        <div style={{opacity:showHints?1:0,transition:showHints?"opacity 0.15s":"none",display:"flex",flexDirection:"column",alignItems:"center",gap:0}}>
          {curData.strokes.length>1&&(
            <div style={{marginTop:8,fontSize:11,color:"var(--text-dim)",letterSpacing:1}}>
              STROKE {Math.min(strokeIndex+1,curData.strokes.length)} OF {curData.strokes.length}
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:0}}>
            <div style={{marginTop:10,fontSize:16,color:"var(--accent)",fontWeight:600,display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap"}}>
              {curData.strokes.map((s,idx)=>(
                <span key={idx} style={{
                  padding:"2px 8px",
                  borderRadius:4,
                  background:idx===strokeIndex?"var(--accent)":"transparent",
                  color:idx===strokeIndex?"#fff":idx<strokeIndex?"var(--success)":"var(--text-dim)",
                  opacity:idx<strokeIndex?0.6:1,
                  textDecoration:idx<strokeIndex?"line-through":"none",
                  border:idx===strokeIndex?"none":"1px solid var(--surface2)",
                }}>{s}</span>
              ))}
            </div>
            {currentStrokeKeys&&(
              <div style={{marginTop:6,fontSize:14,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
                {currentStrokeKeys.map((sk,idx)=>{const fc=getStenoKeyColor(sk);return(<span key={idx}>{idx>0&&<span style={{margin:"0 2px",opacity:0.3}}>+</span>}<span style={{padding:"2px 8px",borderRadius:4,background:`${fc}20`,border:`2px solid ${fc}`,fontWeight:700,fontSize:13,color:fc}}>{sk}</span></span>);})}
              </div>
            )}
          </div>
        </div>
      </div>)}

      {sentenceComplete&&(<div style={{marginBottom:16,textAlign:"center",minHeight:130,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:56,fontWeight:800,letterSpacing:-1,lineHeight:1,color:"var(--success)",textShadow:"0 0 40px rgba(48,164,108,0.3)"}}>Complete</div>
      </div>)}

      {!curData&&curStr&&(<div style={{marginBottom:16,textAlign:"center",minHeight:130,display:"flex",alignItems:"center"}}>
        <div style={{fontSize:20,color:"var(--error)"}}>"{curStr}" not in dictionary — Enter to skip</div>
      </div>)}

      <div style={{marginBottom:8,opacity:showHints&&!sentenceComplete?1:0,transition:showHints&&!sentenceComplete?"opacity 0.15s":"none"}}><UniKeyboard activeKeys={showHints&&!sentenceComplete?activeUni:new Set()} showFingers={showFingers}/></div>
      <input ref={inputRef} autoFocus aria-label="Steno input capture" onInput={handleInput} style={{width:1,height:1,opacity:0,border:0,padding:0,margin:0,pointerEvents:"none"}}/>

      <div style={{marginTop:12,fontSize:11,color:"var(--text-dim)",opacity:0.5}}>{SENTENCES.length} sentences · {Object.keys(WORD_MAP).length} words · Lapwing theory · Uni v4</div>
    </div>
  );
}
