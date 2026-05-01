import { useState, useEffect, useCallback, useRef } from "react";
import lapwingData from "../lapwing-base.json";

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

const SENTENCES = [
  "the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now only back work because day much still may start world little here keep last home hand must each big man their get take look even want these most right down never both long same since make time just year good first give between thing need many point life again while place like great name find",
  "Software engineering is the systematic application of engineering principles to the design, development, and maintenance of software systems. It involves understanding user requirements, creating robust architectures, and ensuring quality through rigorous testing and optimization. A key focus is on delivering scalable, efficient, and reliable solutions that meet both functional and non-functional requirements. Collaboration with cross-functional teams, including designers, product managers, and testers, is essential for successful project delivery. In an ever-evolving field, software engineers must continuously update their skills to stay ahead of emerging technologies and best practices.",
  "it is the","you can be","he is about it","it had to be",
  "it is on the","you and he was at","we will have this",
  "if you can do it","who did ask for this","that was so off",
  "from this up to that","we could have been","would you be with me",
  "after that we did go","there should be some help",
  "what do they also do","she was in but he was out",
  "how can we put them all in","no one has been there before",
  "tell me why you set it","they go to her old home",
  "two of them are well","which one should we do",
  "i think they will come back","then we can start a new day",
  "you should not say more than that","let me try to use this",
  "some people still work through the day","she may call them by name",
  "my own way is the only way","i want to see the world",
  "he would not let her in","they can run but not for long",
  "you must get your work right",
  "i know now that each one can help",
  "take your time and keep it here","he never did go back home",
  "both of them had a big hand in it",
  "most people do not look back",
  "you can find him down at the end",
  "between you and me this is not right",
  "get into it and never give up",
  "just make a good point about life",
  "i need to find the same place again",
  "for a long time we did not know",
  "look at the first thing you can find",
  "since last year many good people have been here",
  "they just need more time to make it great",
  "while you look for a name i will think",
  "give me one good year and i will do it",
];

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
    <span style={{fontSize:14,fontWeight:700,lineHeight:1,color,opacity:data.dim&&!active?0.4:1}}>{data.label}</span>
  </div>);
}

function UniKeyboard({activeKeys,showFingers}){
  const a=activeKeys;
  return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
    {UNI_ROWS.map((row,ri)=>(<div key={ri} style={{display:"flex",gap:0}}>
      {row.map((kd,ki)=>(<Key key={`${ri}-${ki}`} data={kd} active={kd&&a.has(kd.id)} showFingers={showFingers}/>))}
    </div>))}
    {showFingers&&(<div style={{marginTop:12,display:"flex",gap:4,flexWrap:"wrap",justifyContent:"center"}}>
      {FINGER_LABELS.map(f=>(<div key={f.id} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:4,background:"var(--surface)",fontSize:10,color:"var(--text-dim)"}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:FINGER_COLORS[f.id]}}/>{f.label}
      </div>))}
    </div>)}
  </div>);
}

export default function StenoTrainer(){
  const[si,setSi]=useState(0);
  const[wi,setWi]=useState(0);
  const[strokeIndex,setStrokeIndex]=useState(0);
  const[showHints,setShowHints]=useState(true);
  const[showFingers,setShowFingers]=useState(true);
  const[fb,setFb]=useState(null);
  const[streak,setStreak]=useState(0);
  const[best,setBest]=useState(0);
  const[correct,setCorrect]=useState(0);
  const[attempts,setAttempts]=useState(0);
  const[showList,setShowList]=useState(false);
  const inputRef=useRef(null);
  const fbRef=useRef(null);
  const settleRef=useRef(null);
  const wordStartOffsetRef=useRef(0);

  const sentence=SENTENCES[si]||SENTENCES[0];
  const words=sentence.split(" ");
  const curStr=words[wi];
  const curData=WORD_MAP[stripWord(curStr)];

  // Keep latest curData accessible inside debounced callback without stale closure.
  const curDataRef=useRef(curData);
  useEffect(()=>{curDataRef.current=curData;},[curData]);

  const advance=useCallback(()=>{
    setWi(prev=>{
      if(prev+1>=sentence.split(" ").length){
        console.log("[advance] end of sentence -> next sentence");
        setSi(s=>(s+1)%SENTENCES.length);
        return 0;
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
    setStrokeIndex(0);
    const offset=inputRef.current?inputRef.current.value.length:0;
    wordStartOffsetRef.current=offset;
    console.log("[word change]",{
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
    const data=curDataRef.current;
    if(!data){console.log("[stroke] no data for current word, ignoring");return;}
    const fullValue=inputRef.current.value;
    const currentOutput=fullValue.substring(wordStartOffsetRef.current);

    setStrokeIndex(prev=>{
      const isLast=prev>=data.strokes.length-1;
      const expected=data.cumulativePrefixOutputs[prev];
      const normalized=currentOutput.trim().toLowerCase();
      const matches=expected==null?true:normalized===expected.toLowerCase();

      console.log("[stroke]",{
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
          setFb("correct");
          setAttempts(a=>a+1);
          setStreak(s=>{const n=s+1;setBest(b=>Math.max(b,n));return n;});
          setCorrect(c=>c+1);
          wordStartOffsetRef.current=fullValue.length;
          console.log("[word complete]",{word:data.word,finalOutput:currentOutput});
          setTimeout(()=>{setFb(null);advR.current();},0);
        } else {
          // Wrong word typed — flash error, reset so they try the whole word again.
          console.log("[word wrong]",{word:data.word,normalized,expected});
          setFb("wrong");
          setAttempts(a=>a+1);
          setStreak(0);
          if(fbRef.current)clearTimeout(fbRef.current);
          fbRef.current=setTimeout(()=>setFb(null),400);
          // Move offset forward so next attempt isn't confused by previous output.
          wordStartOffsetRef.current=fullValue.length;
        }
        return 0; // reset stroke index regardless
      }

      if(!matches){
        // Intermediate stroke mismatch — flag it but keep accepting strokes
        // since we can't undo what Plover already emitted.
        console.log("[stroke wrong] intermediate mismatch");
        setFb("wrong");
        setAttempts(a=>a+1);
        setStreak(0);
        if(fbRef.current)clearTimeout(fbRef.current);
        fbRef.current=setTimeout(()=>setFb(null),300);
      }
      return prev+1;
    });
  },[]);

  const handleInput=useCallback((e)=>{
    console.log("[input]",{
      value:e.target.value,
      length:e.target.value.length,
      offset:wordStartOffsetRef.current,
      slice:e.target.value.substring(wordStartOffsetRef.current),
    });
    // Coalesce the keystroke burst Plover emits per chord into one stroke event.
    if(settleRef.current)clearTimeout(settleRef.current);
    settleRef.current=setTimeout(()=>evaluateStroke(),50);
  },[evaluateStroke]);

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
        console.log("[skip] Enter pressed, advancing");
        advR.current();
      }
    };
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[]);

  useEffect(()=>{
    const iv=setInterval(()=>{if(inputRef.current&&document.activeElement!==inputRef.current)inputRef.current.focus();},200);
    return()=>clearInterval(iv);
  },[]);

  const acc=attempts>0?Math.round(correct/attempts*100):0;
  const currentStrokeKeys=curData&&strokeIndex<curData.strokes.length
    ?curData.stenoKeys[strokeIndex]
    :null;
  const activeUni=currentStrokeKeys?getActiveUniKeys(currentStrokeKeys):new Set();

  const getStenoKeyColor=(sk)=>{
    const m=STENO_TO_UNI[sk];if(!m)return"var(--text-dim)";
    const kd=UNI_ROWS.flat().find(k=>k&&k.id===m[0]);
    return kd?FINGER_COLORS[kd.finger]:"var(--text-dim)";
  };

  return(
    <div style={{"--bg":"#0f1119","--surface":"#1a1d2e","--surface2":"#232741","--text":"#e8eaf0","--text-dim":"#7b7f96","--accent":"#4f8cff","--hl-text":"#b8d4ff","--key-bg":"#1e2235","--key-border":"#2d3250","--key-text":"#8b8faa","--key-shadow":"#0a0c14","--error":"#e5484d","--success":"#30a46c",minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'JetBrains Mono','SF Mono','Fira Code',monospace",display:"flex",flexDirection:"column",alignItems:"center",padding:"24px 16px",boxSizing:"border-box"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}`}</style>
      <input ref={inputRef} autoFocus onInput={handleInput} style={{position:"absolute",top:-100,left:-100,width:1,height:1,opacity:0,pointerEvents:"none"}}/>

      <div style={{textAlign:"center",marginBottom:16}}>
        <h1 style={{fontSize:28,fontWeight:800,letterSpacing:-1,background:"linear-gradient(135deg,#4f8cff,#a78bfa)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>STENO TRAINER</h1>
        <p style={{fontSize:12,color:"var(--text-dim)",marginTop:4}}>Uni v4 · Lapwing theory · Chord the highlighted keys · Enter to skip</p>
      </div>

      <div style={{display:"flex",gap:24,marginBottom:16,fontSize:13,color:"var(--text-dim)"}}>
        <span>Streak <strong style={{color:streak>0?"var(--success)":"var(--text-dim)"}}>{streak}</strong></span>
        <span>Best <strong style={{color:"var(--accent)"}}>{best}</strong></span>
        <span>Accuracy <strong style={{color:acc>=80?"var(--success)":"var(--text-dim)"}}>{acc}%</strong></span>
      </div>

      <div style={{marginBottom:8,padding:"10px 20px",borderRadius:8,background:"var(--surface)",border:"1px solid var(--surface2)",maxWidth:700,width:"100%",textAlign:"center",minHeight:44,display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"4px 8px"}}>
        {words.map((w,idx)=>{
          const done=idx<wi,cur=idx===wi,isFirst=idx===0,isLast=idx===words.length-1;
          const display=(isFirst?w.charAt(0).toUpperCase()+w.slice(1):w)+(isLast?".":"");
          return(<span key={idx} style={{fontSize:16,fontWeight:cur?800:400,color:done?"var(--success)":cur?"var(--text)":"var(--text-dim)",opacity:done?0.6:1,textDecoration:done?"line-through":"none",transition:"all 0.15s"}}>{display}</span>);
        })}
      </div>

      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
        <span style={{fontSize:11,color:"var(--text-dim)"}}>{si+1}/{SENTENCES.length}</span>
        <button onClick={()=>setShowList(!showList)} style={{padding:"3px 10px",borderRadius:4,border:"1px solid var(--surface2)",background:"transparent",color:"var(--text-dim)",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{showList?"Hide":"Pick sentence"}</button>
      </div>

      {showList&&(<div style={{maxWidth:700,width:"100%",maxHeight:200,overflowY:"auto",background:"var(--surface)",border:"1px solid var(--surface2)",borderRadius:8,marginBottom:16,padding:8}}>
        {SENTENCES.map((s,idx)=>(<div key={idx} onClick={()=>{setSi(idx);setWi(0);setShowList(false);setFb(null);if(inputRef.current)wordStartOffsetRef.current=inputRef.current.value.length;}} style={{padding:"6px 10px",borderRadius:4,cursor:"pointer",fontSize:12,color:idx===si?"var(--accent)":"var(--text-dim)",background:idx===si?"var(--surface2)":"transparent",fontWeight:idx===si?700:400}}>{idx+1}. {s}</div>))}
      </div>)}

      {curData&&(<div style={{marginBottom:16,textAlign:"center",minHeight:130,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:72,fontWeight:800,letterSpacing:-2,lineHeight:1,color:fb==="correct"?"var(--success)":fb==="wrong"?"var(--error)":"var(--text)",transition:"color 0.15s",textShadow:fb==="correct"?"0 0 40px rgba(48,164,108,0.3)":fb==="wrong"?"0 0 40px rgba(229,72,77,0.3)":"none"}}>
          {(wi===0?curStr.charAt(0).toUpperCase()+curStr.slice(1):curStr)+(wi===words.length-1?".":"")}
        </div>
        {curData.strokes.length>1&&(
          <div style={{marginTop:8,fontSize:11,color:"var(--text-dim)",letterSpacing:1}}>
            STROKE {Math.min(strokeIndex+1,curData.strokes.length)} OF {curData.strokes.length}
          </div>
        )}
        {showHints&&(<>
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
        </>)}
      </div>)}

      {!curData&&curStr&&(<div style={{marginBottom:16,textAlign:"center",minHeight:130,display:"flex",alignItems:"center"}}>
        <div style={{fontSize:20,color:"var(--error)"}}>"{curStr}" not in dictionary — Enter to skip</div>
      </div>)}

      <div style={{marginBottom:20}}><UniKeyboard activeKeys={showHints?activeUni:new Set()} showFingers={showFingers}/></div>

      <div style={{display:"flex",gap:20,fontSize:13,color:"var(--text-dim)"}}>
        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}><input type="checkbox" checked={showHints} onChange={e=>setShowHints(e.target.checked)} style={{accentColor:"var(--accent)"}}/>Show hints</label>
        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}><input type="checkbox" checked={showFingers} onChange={e=>setShowFingers(e.target.checked)} style={{accentColor:"var(--accent)"}}/>Finger map</label>
      </div>

      <div style={{marginTop:12,fontSize:11,color:"var(--text-dim)",opacity:0.5}}>{SENTENCES.length} sentences · {Object.keys(WORD_MAP).length} words · Lapwing theory · Uni v4</div>
    </div>
  );
}
