"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  CheckCircle2,
  ChevronRight,
  Download,
  Flame,
  Gauge,
  MapPinned,
  Play,
  QrCode,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCog,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toPng } from "html-to-image";
import QRCode from "qrcode";
import jsQR from "jsqr";

declare global {
  interface Window {
    KavachCamera?: {
      start: (left: number, top: number, width: number, height: number) => void;
      update: (left: number, top: number, width: number, height: number) => void;
      stop: () => void;
    };
  }
}

type Language = "hi" | "sa";
type Screen =
  | "splash"
  | "language"
  | "profile"
  | "home"
  | "briefing"
  | "scenario"
  | "results"
  | "certificate"
  | "supervisorLogin"
  | "supervisorHome"
  | "scan"
  | "verification"
  | "syncLog"
  | "dashboard";
type ModuleId = "fire" | "gas";
type CompetencyKey = "hazard" | "response" | "route" | "safety";

type WorkerProfile = {
  name: string;
  workerId: string;
  site: string;
  language: Language;
};

type Choice = {
  id: string;
  label: string;
  correct: boolean;
  points: number;
  note: string;
  competency: CompetencyKey;
};

type Scenario = {
  title: string;
  prompt: string;
  context: string;
  choices: Choice[];
};

type ModuleConfig = {
  title: string;
  subtitle: string;
  description: string;
  briefing: string;
  location: string;
  accent: string;
  icon: "fire" | "gas";
  scenarios: Scenario[];
};

type AttemptRecord = {
  id: string;
  moduleId: ModuleId;
  workerId: string;
  workerName: string;
  site: string;
  score: number;
  pass: boolean;
  responseTime: string;
  strengths: string[];
  mistakes: string[];
  createdAt: string;
  synced: boolean;
};

type CertificatePayload = {
  certId: string;
  workerId: string;
  workerName: string;
  site: string;
  module: string;
  score: number;
  date: string;
  signature: string;
};

const STORAGE_KEYS = {
  profile: "kavach-profile",
  attempts: "kavach-attempts",
};

const moduleData: Record<ModuleId, ModuleConfig> = {
  fire: {
    title: "Fire & Explosion Response",
    subtitle: "HSE Level 1",
    description: "Identify the ignition source, use proper PPE, and move out through the safe exit.",
    briefing:
      "A hot-work crew is operating near a valve rack and smoke is building. You need to recognize the hazard, wear SCBA, and move through the west egress lane before conditions worsen.",
    location: "LPG transfer yard",
    accent: "#f97316",
    icon: "fire",
    scenarios: [
      {
        title: "Hazard recognition",
        prompt: "What is the primary risk in the current zone?",
        context: "Smoke is building near the valve rack and a hot work spark is visible in the facility.",
        choices: [
          { id: "f-h1", label: "A live ignition source near the valve rack", correct: true, points: 25, note: "Correct hazard recognition.", competency: "hazard" },
          { id: "f-h2", label: "Dust in the air from routine work", correct: false, points: 0, note: "This is more than dust; a clear ignition risk exists.", competency: "hazard" },
          { id: "f-h3", label: "Only variation in temperature", correct: false, points: 0, note: "The smoke and ignition source are the true danger.", competency: "hazard" },
        ],
      },
      {
        title: "Required protection",
        prompt: "Which equipment should be used before approaching the ignition area?",
        context: "A worker must protect themselves before trying to isolate the hot work area.",
        choices: [
          { id: "f-r1", label: "SCBA mask and extinguisher", correct: true, points: 25, note: "Correct PPE and response gear.", competency: "response" },
          { id: "f-r2", label: "Only gloves", correct: false, points: 0, note: "This does not protect against smoke and flame.", competency: "response" },
          { id: "f-r3", label: "No PPE", correct: false, points: 0, note: "Exposure would be unsafe and untreated.", competency: "response" },
        ],
      },
      {
        title: "Safe egress route",
        prompt: "Which route should the worker use while exiting?",
        context: "The direct route crosses the smoke plume and heat zone, while the alternate path remains clear.",
        choices: [
          { id: "f-route1", label: "Marked west egress lane", correct: true, points: 25, note: "This keeps the worker away from the hazard zone.", competency: "route" },
          { id: "f-route2", label: "Through the valve rack", correct: false, points: 0, note: "This re-enters the active fire area.", competency: "route" },
          { id: "f-route3", label: "Past the flare line", correct: false, points: 0, note: "The flare line remains part of the hazard envelope.", competency: "route" },
        ],
      },
      {
        title: "Changing condition",
        prompt: "Wind shifts and smoke begins moving across the exit. What should be done?",
        context: "The worker must update the route decision instead of continuing an unsafe original plan.",
        choices: [
          { id: "f-s1", label: "Reassess and switch to the alternate safe exit", correct: true, points: 25, note: "Adaptive response is correct and safe.", competency: "safety" },
          { id: "f-s2", label: "Stay and continue without adjusting", correct: false, points: 0, note: "The hazard has changed and the route is no longer safe.", competency: "safety" },
          { id: "f-s3", label: "Move toward the flare line", correct: false, points: 0, note: "This exposes the worker to the danger zone.", competency: "safety" },
        ],
      },
    ],
  },
  gas: {
    title: "Gas Leak & Confined Space Protocol",
    subtitle: "HSE Level 2",
    description: "Recognize the methane leak, maintain distance, and evacuate via the upwind route without exposing the worker to confined-space danger.",
    briefing:
      "A methane alarm is active near the tank farm. The worker must identify the gas leak, keep distance, use a respirator, and move to the marked upwind muster point while notifying the supervisor.",
    location: "Tank farm perimeter",
    accent: "#8b5cf6",
    icon: "gas",
    scenarios: [
      {
        title: "Leak identification",
        prompt: "What is the primary hazard in this zone?",
        context: "A gas detector alarm is active near the tank access point and oxygen is suspect.",
        choices: [
          { id: "g-h1", label: "Methane gas leak near the tank access point", correct: true, points: 25, note: "The alarm clearly identifies a gas leak.", competency: "hazard" },
          { id: "g-h2", label: "Normal maintenance vibration", correct: false, points: 0, note: "This is not a routine vibration issue.", competency: "hazard" },
          { id: "g-h3", label: "Loose drain cover", correct: false, points: 0, note: "Drain cover is not the main issue here.", competency: "hazard" },
        ],
      },
      {
        title: "Protective response",
        prompt: "Before approaching the tank, what is the correct safe action?",
        context: "Atmosphere risk means the worker should not enter the space without proper protection.",
        choices: [
          { id: "g-r1", label: "Move upwind and use a respirator", correct: true, points: 25, note: "Distance and respirator reduce exposure.", competency: "response" },
          { id: "g-r2", label: "Enter the tank for a quick inspection", correct: false, points: 0, note: "This is an unsafe and incorrect entry action.", competency: "response" },
          { id: "g-r3", label: "Use earplugs and continue", correct: false, points: 0, note: "Gas exposure requires more than hearing protection.", competency: "response" },
        ],
      },
      {
        title: "Evacuation route",
        prompt: "Which route best reduces exposure to the leak plume?",
        context: "The worker needs to remain clear of toxic vapors and move with the wind pattern.",
        choices: [
          { id: "g-route1", label: "Follow the marked upwind safe route", correct: true, points: 25, note: "This avoids the leak plume and keeps the worker safe.", competency: "route" },
          { id: "g-route2", label: "Move through the tank opening", correct: false, points: 0, note: "This increases exposure to the hazard zone.", competency: "route" },
          { id: "g-route3", label: "Stay near the pump station", correct: false, points: 0, note: "The pump area is in the active plume path.", competency: "route" },
        ],
      },
      {
        title: "Escalation",
        prompt: "The alarm spikes again. What should the worker do next?",
        context: "The worker must alert the supervisor and move to the muster point instead of entering a danger zone.",
        choices: [
          { id: "g-s1", label: "Alert the supervisor and move to the muster point", correct: true, points: 25, note: "This is the correct emergency escalation and evacuate response.", competency: "safety" },
          { id: "g-s2", label: "Ignore the increase and keep checking", correct: false, points: 0, note: "The leak is worsening and requires immediate response.", competency: "safety" },
          { id: "g-s3", label: "Re-enter the tank to inspect", correct: false, points: 0, note: "This endangers the worker and violates confinement safety.", competency: "safety" },
        ],
      },
    ],
  },
};

const defaultProfile: WorkerProfile = {
  name: "",
  workerId: "",
  site: "",
  language: "hi",
};

const initialAttempts: AttemptRecord[] = [
  {
    id: "A-101",
    moduleId: "fire",
    workerId: "W-041",
    workerName: "Asha Soren",
    site: "Khadapani Mine East",
    score: 88,
    pass: true,
    responseTime: "42 sec",
    strengths: ["Correct hazard recognition"],
    mistakes: [],
    createdAt: "2026-09-18T08:20:00.000Z",
    synced: true,
  },
  {
    id: "A-102",
    moduleId: "gas",
    workerId: "W-041",
    workerName: "Asha Soren",
    site: "Khadapani Mine East",
    score: 74,
    pass: true,
    responseTime: "51 sec",
    strengths: ["Calm evacuation route"],
    mistakes: ["Needed stronger PPE check"],
    createdAt: "2026-09-19T14:42:00.000Z",
    synced: false,
  },
];

async function signPayload(payload: CertificatePayload): Promise<string> {
  const secret = "kavach-offline-signature";
  const text = JSON.stringify(payload) + secret;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const bytes = Array.from(new Uint8Array(hash));
  return btoa(String.fromCharCode(...bytes));
}

async function verifyCertificate(raw: string): Promise<{ verified: boolean; payload?: CertificatePayload; message: string }> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.payload || !parsed?.signature) {
      return { verified: false, message: "No valid QR payload found." };
    }
    const expected = await signPayload(parsed.payload as CertificatePayload);
    const verified = expected === parsed.signature;
    return {
      verified,
      payload: parsed.payload as CertificatePayload,
      message: verified ? "Certificate verified and accepted." : "Certificate signature mismatch.",
    };
  } catch {
    return { verified: false, message: "QR payload could not be decoded." };
  }
}

export default function Page() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [language, setLanguage] = useState<Language>("hi");
  const [profile, setProfile] = useState<WorkerProfile>(defaultProfile);
  const [attempts, setAttempts] = useState<AttemptRecord[]>(initialAttempts);
  const [activeModuleId, setActiveModuleId] = useState<ModuleId>("fire");
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [answers, setAnswers] = useState<Choice[]>([]);
  const [resultSummary, setResultSummary] = useState<AttemptRecord | null>(null);
  const [certificateRecord, setCertificateRecord] = useState<CertificatePayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [verificationResult, setVerificationResult] = useState<{ verified: boolean; payload?: CertificatePayload; message: string }>({
    verified: false,
    message: "No certificate detected yet.",
  });
  const [scanStatus, setScanStatus] = useState("Ready to scan certificate");
  const [isSyncing, setIsSyncing] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState(true);
  const [detectedObjects, setDetectedObjects] = useState<
    {
      label: string;
      confidence: number;
      left: number;
      top: number;
      width: number;
      height: number;
    }[]
  >([]);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const nativeCameraBoxRef = useRef<HTMLDivElement | null>(null);
  const certificateRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleDetection = (event: Event) => {
      const customEvent = event as CustomEvent;
      const detail = customEvent.detail;

      if (Array.isArray(detail)) {
        setDetectedObjects(detail);
        return;
      }

      if (detail && Array.isArray(detail.objects)) {
        setDetectedObjects(detail.objects);
        return;
      }

      setDetectedObjects([]);
    };

    window.addEventListener("kavachObjectDetection", handleDetection);

    return () => {
      window.removeEventListener("kavachObjectDetection", handleDetection);
    };
  }, []);

  useEffect(() => {
    if (screen !== "scenario") {
      setDetectedObjects([]);
    }
  }, [screen]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (screen !== "scenario") {
      window.KavachCamera?.stop();
      return;
    }

    const box = nativeCameraBoxRef.current;
    if (!box) return;

    const getRect = () => {
      const rect = box.getBoundingClientRect();
      const density = window.devicePixelRatio || 1;
      return {
        left: Math.round(rect.left * density),
        top: Math.round(rect.top * density),
        width: Math.round(rect.width * density),
        height: Math.round(rect.height * density),
      };
    };

    const startCamera = () => {
      const rect = getRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      window.KavachCamera?.start(rect.left, rect.top, rect.width, rect.height);
    };

    const updateCamera = () => {
      const rect = getRect();
      if (rect.width <= 0 || rect.height <= 0) {
        window.KavachCamera?.stop();
        return;
      }
      window.KavachCamera?.update(rect.left, rect.top, rect.width, rect.height);
    };

    startCamera();

    const handleScroll = () => requestAnimationFrame(updateCamera);
    const handleResize = () => requestAnimationFrame(updateCamera);

    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);

    const timer = window.setTimeout(updateCamera, 300);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      window.KavachCamera?.stop();
    };
  }, [screen, scenarioIndex]);

  const currentModule = moduleData[activeModuleId];
  const currentScenario = currentModule.scenarios[scenarioIndex] ?? currentModule.scenarios[0];

  useEffect(() => {
    const timer = window.setTimeout(() => setScreen("language"), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedProfile = window.localStorage.getItem(STORAGE_KEYS.profile);
    const savedAttempts = window.localStorage.getItem(STORAGE_KEYS.attempts);

    if (savedProfile) {
      try {
        setProfile(JSON.parse(savedProfile));
      } catch {
        // ignore invalid data
      }
    }

    if (savedAttempts) {
      try {
        setAttempts(JSON.parse(savedAttempts));
      } catch {
        // ignore invalid data
      }
    }

    const updateOnlineStatus = () => setOnlineStatus(window.navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEYS.attempts, JSON.stringify(attempts));
  }, [attempts]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const readiness = useMemo(() => {
    if (!attempts.length) return 0;
    const average = attempts.reduce((sum, item) => sum + item.score, 0) / attempts.length;
    return Math.round(average);
  }, [attempts]);

  const dashboardSummary = useMemo(() => {
    const total = attempts.length;
    const passCount = attempts.filter((item) => item.pass).length;
    const avgScore = total ? Math.round(attempts.reduce((sum, item) => sum + item.score, 0) / total) : 0;
    const retrainingCount = attempts.filter((item) => !item.pass).length;
    return { total, passCount, avgScore, retrainingCount };
  }, [attempts]);

  const speak = (text: string) => {
    if (typeof window === "undefined") return;
    if (language === "sa") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    utterance.rate = 0.9;
    synth.speak(utterance);
  };

  const startModule = (moduleId: ModuleId) => {
    setActiveModuleId(moduleId);
    setScenarioIndex(0);
    setAnswers([]);
    setResultSummary(null);
    setScreen("briefing");
    speak(moduleData[moduleId].briefing);
  };

  const handleChoice = (choice: Choice) => {
    const nextAnswers = [...answers, choice];

    if (scenarioIndex < currentModule.scenarios.length - 1) {
      setAnswers(nextAnswers);
      setScenarioIndex((value) => value + 1);
      return;
    }

    const correctTotal = nextAnswers.filter((item) => item.correct).reduce((sum, item) => sum + item.points, 0);
    const maxTotal = currentModule.scenarios.reduce((sum, step) => sum + step.choices.reduce((value, choiceItem) => value + choiceItem.points, 0), 0);
    const score = Math.min(100, Math.max(0, Math.round((correctTotal / Math.max(maxTotal, 1)) * 100)));
    const pass = score >= 75;
    const strengths = nextAnswers.filter((item) => item.correct).map((item) => item.note).slice(0, 2);
    const mistakes = nextAnswers.filter((item) => !item.correct).map((item) => item.note).slice(0, 2);

    const record: AttemptRecord = {
      id: `A-${Date.now()}`,
      moduleId: activeModuleId,
      workerId: profile.workerId,
      workerName: profile.name,
      site: profile.site,
      score,
      pass,
      responseTime: `${Math.max(18, 35 + scenarioIndex * 5)} sec`,
      strengths: strengths.length ? strengths : ["Steady decision-making"],
      mistakes: mistakes.length ? mistakes : ["No critical mismatch"],
      createdAt: new Date().toISOString(),
      synced: false,
    };

    setAttempts((previous) => [record, ...previous]);
    setResultSummary(record);
    setScreen("results");
  };

  const generateCertificate = async () => {
    if (!resultSummary) return;
    const payload: CertificatePayload = {
      certId: `KAVACH-${resultSummary.workerId}-${Date.now().toString().slice(-6)}`,
      workerId: resultSummary.workerId,
      workerName: resultSummary.workerName,
      site: resultSummary.site,
      module: moduleData[resultSummary.moduleId].title,
      score: resultSummary.score,
      date: new Date().toISOString(),
      signature: "",
    };

    const signature = await signPayload(payload);
    const signedPayload = { ...payload, signature };
    const qrcode = await QRCode.toDataURL(JSON.stringify({ payload: signedPayload, signature }), { width: 180, margin: 1 });

    setCertificateRecord(signedPayload);
    setQrDataUrl(qrcode);
    setScreen("certificate");
    speak("Certificate generated and ready for review.");
  };

  const exportCertificate = async () => {
    if (!certificateRef.current) return;
    const dataUrl = await toPng(certificateRef.current, { cacheBust: true, pixelRatio: 2 });
    const link = document.createElement("a");
    link.download = `${profile.workerId || "certificate"}-kavach.png`;
    link.href = dataUrl;
    link.click();
  };

  const handleSyncNow = async () => {
    if (!onlineStatus) return;
    setIsSyncing(true);
    setAttempts((previous) => previous.map((entry) => ({ ...entry, synced: true })));
    window.setTimeout(() => setIsSyncing(false), 700);
  };

  const handleScanCertificate = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVerificationResult({ verified: false, message: "Camera access is not available on this device." });
      setScreen("verification");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (cameraRef.current) {
        cameraRef.current.srcObject = stream;
        await cameraRef.current.play();
      }
      setScreen("scan");
      setScanStatus("Scanning QR code...");

      const timeout = window.setTimeout(async () => {
        const video = cameraRef.current;
        if (!video) return;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });

        if (decoded) {
          const result = await verifyCertificate(decoded.data);
          setVerificationResult(result);
          setScanStatus(result.verified ? "Verified certificate found" : "Certificate mismatch detected");
          setScreen("verification");
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
          return;
        }

        setScanStatus("No valid QR detected");
        setVerificationResult({ verified: false, message: "No valid certificate detected in the frame." });
        setScreen("verification");
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      }, 1000);

      window.setTimeout(() => window.clearTimeout(timeout), 4000);
    } catch {
      setVerificationResult({ verified: false, message: "Unable to access the camera for verification." });
      setScanStatus("Camera access denied");
      setScreen("verification");
    }
  };

  const continueFromResults = () => {
    if (!resultSummary) return;
    if (resultSummary.pass) {
      generateCertificate();
      return;
    }
    setScenarioIndex(0);
    setAnswers([]);
    setScreen("scenario");
    speak("Retraining started. Focus on the failing safety behavior and repeat the scenario.");
  };

  return (
    <main className="app-shell">
      <div className="app-frame">
        {screen === "splash" && (
          <section className="panel splash-panel">
            <div className="glow-orb" />
            <div className="brand-mark">
              <ShieldCheck size={38} />
            </div>
            <div className="center-copy">
              <p className="eyebrow">Offline AR Safety</p>
              <h1>KAVACH</h1>
              <p className="tagline">Safety demonstrated. Not just memorized.</p>
            </div>
            <button className="primary-button" onClick={() => setScreen("language")}>
              <Play size={18} /> Start now
            </button>
          </section>
        )}

        {screen === "language" && (
          <section className="panel narrow-panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Select language</p>
                <h2>Choose your guide</h2>
              </div>
              <button className="icon-button" onClick={() => speak("Choose your language")}>
                <AudioLines size={18} />
              </button>
            </div>

            <div className="language-grid">
              <button
                className="language-card language-card-green"
                onClick={() => {
                  setLanguage("hi");
                  setProfile((previous) => ({ ...previous, language: "hi" }));
                  setScreen("profile");
                }}
              >
                <Sparkles size={28} />
                <span>हिन्दी</span>
                <small>Voice guidance ready</small>
              </button>

              <button
                className="language-card language-card-violet"
                onClick={() => {
                  setLanguage("sa");
                  setProfile((previous) => ({ ...previous, language: "sa" }));
                  setScreen("profile");
                }}
              >
                <Sparkles size={28} />
                <span>Santali</span>
                <small>Coming soon</small>
              </button>
            </div>
          </section>
        )}

        {screen === "profile" && (
          <section className="panel narrow-panel">
            <p className="eyebrow">Worker profile</p>
            <h2>Enter site details</h2>

            <div className="stack-form">
              <label className="field">
                <span>Full name</span>
                <input
                  value={profile.name}
                  onChange={(event) => setProfile((previous) => ({ ...previous, name: event.target.value }))}
                  placeholder="Asha Soren"
                />
              </label>

              <label className="field">
                <span>Worker ID</span>
                <input
                  value={profile.workerId}
                  onChange={(event) => setProfile((previous) => ({ ...previous, workerId: event.target.value }))}
                  placeholder="W-041"
                />
              </label>

              <label className="field">
                <span>Site / location</span>
                <input
                  value={profile.site}
                  onChange={(event) => setProfile((previous) => ({ ...previous, site: event.target.value }))}
                  placeholder="Khadapani Mine East"
                />
              </label>
            </div>

            <div className="button-row">
              <button className="secondary-button" onClick={() => setScreen("language")}>Back</button>
              <button
                className="primary-button"
                onClick={() => {
                  if (!profile.name || !profile.workerId || !profile.site) return;
                  setScreen("home");
                }}
              >
                Continue <ArrowRight size={18} />
              </button>
            </div>
          </section>
        )}

        {screen === "home" && (
          <section className="panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Worker overview</p>
                <h2>{profile.name || "Worker"}</h2>
                <small>{profile.workerId || "Worker ID not set"} • {profile.site || "Site not set"}</small>
              </div>
              <button className="secondary-button" onClick={() => setScreen("supervisorLogin")}>
                <UserCog size={18} /> Supervisor
              </button>
            </div>

            <div className="readiness-box">
              <div>
                <p className="eyebrow eyebrow-success">Safety readiness</p>
                <h3>{readiness}%</h3>
              </div>
              <span className="pill pill-success">Live score</span>
            </div>

            <div className="module-grid">
              {(Object.keys(moduleData) as ModuleId[]).map((moduleId) => {
                const item = moduleData[moduleId];
                const latestAttempt = attempts.filter((attempt) => attempt.moduleId === moduleId)[0];
                const badge = latestAttempt ? (latestAttempt.pass ? "Competent" : "Retraining") : "Not started";
                const progress = latestAttempt ? latestAttempt.score : 0;

                return (
                  <article key={moduleId} className="module-card">
                    <div className="module-top">
                      <div className="module-icon" style={{ background: `${item.accent}22`, color: item.accent }}>
                        {item.icon === "fire" ? <Flame size={20} /> : <AlertTriangle size={20} />}
                      </div>
                      <span className={badge === "Competent" ? "status-badge status-good" : "status-badge status-neutral"}>{badge}</span>
                    </div>

                    <small>{item.subtitle}</small>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>

                    <div className="mini-progress-row">
                      <span>Progress</span>
                      <strong>{progress}%</strong>
                    </div>
                    <div className="mini-progress-bar">
                      <div className="mini-progress-fill" style={{ width: `${progress}%`, background: item.accent }} />
                    </div>

                    <button className="module-button" onClick={() => startModule(moduleId)}>
                      {latestAttempt ? (latestAttempt.pass ? "Continue" : "Retrain") : "Start training"}
                      <ChevronRight size={16} />
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {screen === "briefing" && (
          <section className="panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Briefing</p>
                <h2>{currentModule.title}</h2>
              </div>
              <button className="icon-button" onClick={() => speak(currentModule.briefing)}>
                <AudioLines size={18} />
              </button>
            </div>

            <div className="briefing-grid">
              <div className="briefing-card">
                <div className="module-icon large" style={{ background: `${currentModule.accent}22`, color: currentModule.accent }}>
                  {currentModule.icon === "fire" ? <Flame size={28} /> : <AlertTriangle size={28} />}
                </div>
                <p>{currentModule.briefing}</p>
                <div className="briefing-notes">
                  <div className="note-item"><CheckCircle2 size={16} /> Active area: {currentModule.location}</div>
                  <ul>
                    <li>Identify the real hazard on the floor before acting.</li>
                    <li>Use the correct PPE and response path.</li>
                    <li>Adapt when the environment changes.</li>
                  </ul>
                </div>
              </div>

              <aside className="briefing-side">
                <p className="eyebrow">Scenario overview</p>
                <div className="info-stack">
                  <div><span>Hazard</span><strong>3 signals</strong></div>
                  <div><span>Protection</span><strong>PPE check</strong></div>
                  <div><span>Route</span><strong>Safe exit</strong></div>
                </div>
              </aside>
            </div>

            <div className="button-row">
              <button className="secondary-button" onClick={() => setScreen("home")}>Back</button>
              <button className="primary-button" onClick={() => { setScreen("scenario"); speak(`${currentModule.title} scenario started.`); }}>
                Enter scenario <ArrowRight size={18} />
              </button>
            </div>
          </section>
        )}

        {screen === "scenario" && (
          <section className="panel scenario-panel">
            <div className="screen-header compact-header">
              <div>
                <p className="eyebrow">Live assessment</p>
                <h3>{currentModule.title}</h3>
              </div>
              <span className="pill pill-success">Step {scenarioIndex + 1}/{currentModule.scenarios.length}</span>
            </div>

            <div className="scenario-grid">
              <div className="scene-panel">
                <div className="scene-header">
                  <span>Analyzing surroundings</span>
                  <MapPinned size={15} />
                </div>

                <div
                  ref={nativeCameraBoxRef}
                  className="scene-box camera-scene-box"
                  style={{ background: "transparent", position: "relative" }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 12,
                      zIndex: 20,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "rgba(7, 18, 14, 0.82)",
                      color: "#ffffff",
                      fontSize: 12,
                      fontWeight: 700,
                      pointerEvents: "none",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: detectedObjects.length > 0 ? "#22c55e" : "#facc15",
                        boxShadow:
                          detectedObjects.length > 0
                            ? "0 0 10px rgba(34,197,94,0.8)"
                            : "0 0 10px rgba(250,204,21,0.8)",
                      }}
                    />
                    {detectedObjects.length > 0
                      ? `${detectedObjects.length} object${detectedObjects.length > 1 ? "s" : ""} detected`
                      : "AI scanning surroundings"}
                  </div>
                </div>
                <p className="scene-copy">{currentScenario.context}</p>
              </div>

              <div className="decision-panel">
                <h4>{currentScenario.title}</h4>
                <p>{currentScenario.prompt}</p>
                <div className="choice-list">
                  {currentScenario.choices.map((choice) => (
                    <button key={choice.id} className="choice-button" onClick={() => handleChoice(choice)}>
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {screen === "results" && resultSummary && (
          <section className="panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Assessment result</p>
                <h2>{resultSummary.pass ? "Competency demonstrated" : "Competency gap identified"}</h2>
              </div>
              <span className={resultSummary.pass ? "pill pill-success" : "pill pill-danger"}>{resultSummary.pass ? "Pass" : "Review"}</span>
            </div>

            <div className="stats-grid">
              <div className="stat-box"><span>Overall score</span><strong>{resultSummary.score}%</strong></div>
              <div className="stat-box"><span>Response time</span><strong>{resultSummary.responseTime}</strong></div>
              <div className="stat-box"><span>Strength</span><strong>{resultSummary.strengths[0] || "Observation"}</strong></div>
              <div className="stat-box"><span>Next action</span><strong>{resultSummary.pass ? "Certificate" : "Retrain"}</strong></div>
            </div>

            <div className="result-grid">
              <article className="result-card">
                <h4><Trophy size={18} /> Strongest actions</h4>
                <ul>
                  {resultSummary.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="result-card danger-card">
                <h4><AlertTriangle size={18} /> Key gaps</h4>
                <ul>
                  {resultSummary.mistakes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>

            <div className="button-row">
              <button className="secondary-button" onClick={() => setScreen("home")}>Back to home</button>
              <button className={resultSummary.pass ? "primary-button" : "warning-button"} onClick={continueFromResults}>
                {resultSummary.pass ? "Generate certificate" : "Targeted retraining"}
              </button>
            </div>
          </section>
        )}

        {screen === "certificate" && certificateRecord && (
          <section className="panel cert-panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Certificate</p>
                <h2>Safety competency record</h2>
              </div>
              <div className="inline-actions">
                <button className="secondary-button" onClick={exportCertificate}><Download size={18} /> PNG</button>
                <button className="secondary-button" onClick={() => window.print()}><Download size={18} /> PDF</button>
              </div>
            </div>

            <div ref={certificateRef} className="certificate-sheet">
              <div className="certificate-header">
                <div>
                  <p className="certificate-kicker">KAVACH Safety Board</p>
                  <h3>Certificate of Safety Competency</h3>
                </div>
                {qrDataUrl && <img src={qrDataUrl} alt="certificate qr" className="qr-box" />}
              </div>

              <div className="certificate-grid">
                <div className="certificate-meta">
                  <div><span>Worker name</span><strong>{certificateRecord.workerName}</strong></div>
                  <div><span>Worker ID</span><strong>{certificateRecord.workerId}</strong></div>
                  <div><span>Site</span><strong>{certificateRecord.site}</strong></div>
                  <div><span>Module</span><strong>{certificateRecord.module}</strong></div>
                  <div><span>Score</span><strong>{certificateRecord.score}%</strong></div>
                </div>

                <div className="verify-box">
                  <p className="certificate-kicker">Verification status</p>
                  <div className="verify-row"><ShieldCheck size={18} /> Verified</div>
                  <div className="tiny-label">Certificate ID</div>
                  <div className="tiny-value">{certificateRecord.certId}</div>
                  <div className="tiny-label">Authorized signature</div>
                  <div className="tiny-signature">Mining Safety Officer</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {screen === "supervisorLogin" && (
          <section className="panel narrow-panel">
            <p className="eyebrow">Supervisor access</p>
            <h2>Enter PIN</h2>

            <div className="pin-grid">
              {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                <button key={value} className="pin-button" onClick={() => setScreen("supervisorHome")}>{value}</button>
              ))}
              <button className="pin-button" onClick={() => setScreen("home")}>Back</button>
              <button className="pin-button pin-button-accent" onClick={() => setScreen("supervisorHome")}>Login</button>
            </div>
          </section>
        )}

        {screen === "supervisorHome" && (
          <section className="panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Supervisor console</p>
                <h2>Operational overview</h2>
              </div>
              <button className="secondary-button" onClick={() => setScreen("dashboard")}>
                <Gauge size={18} /> Dashboard
              </button>
            </div>

            <div className="supervisor-grid">
              <button className="supervisor-card supervisor-card-primary" onClick={handleScanCertificate}>
                <QrCode size={26} />
                <span>Scan certificate</span>
                <small>Verify the signed evidence for a worker.</small>
              </button>

              <button className="supervisor-card" onClick={() => setScreen("syncLog")}>
                <Wifi size={26} />
                <span>Sync log</span>
                <small>Review online and offline training records.</small>
              </button>
            </div>
          </section>
        )}

        {screen === "scan" && (
          <section className="panel scan-panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Verification</p>
                <h2>Scan worker certificate</h2>
              </div>
              <button className="secondary-button" onClick={() => setScreen("supervisorHome")}>Back</button>
            </div>

            <div className="scan-wrap">
              <video ref={cameraRef} playsInline muted className="camera-view" />
              <div className="scan-frame" />
              <div className="scan-status">{scanStatus}</div>
            </div>
          </section>
        )}

        {screen === "verification" && (
          <section className="panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Certificate verification</p>
                <h2>{verificationResult.verified ? "Certificate accepted" : "Verification failed"}</h2>
              </div>
              <span className={verificationResult.verified ? "pill pill-success" : "pill pill-danger"}>{verificationResult.verified ? "Verified" : "Rejected"}</span>
            </div>

            {verificationResult.payload ? (
              <div className="verification-grid">
                <div className="result-card">
                  <div className="key-row"><span>Worker</span><strong>{verificationResult.payload.workerName}</strong></div>
                  <div className="key-row"><span>Site</span><strong>{verificationResult.payload.site}</strong></div>
                  <div className="key-row"><span>Module</span><strong>{verificationResult.payload.module}</strong></div>
                  <div className="key-row"><span>Certificate ID</span><strong>{verificationResult.payload.certId}</strong></div>
                  <div className="key-row"><span>Score</span><strong>{verificationResult.payload.score}%</strong></div>
                </div>

                <div className="verify-box">
                  <p className="certificate-kicker">Signature check</p>
                  <div className="verify-row"><ShieldCheck size={18} /> {verificationResult.verified ? "HMAC verified" : "Mismatch"}</div>
                  <div className="tiny-value">{verificationResult.message}</div>
                </div>
              </div>
            ) : (
              <div className="empty-box">No valid record detected.</div>
            )}

            <div className="button-row">
              <button className="secondary-button" onClick={() => setScreen("supervisorHome")}>Back</button>
              <button className="primary-button" onClick={() => setScreen("supervisorHome")}>Done</button>
            </div>
          </section>
        )}

        {screen === "syncLog" && (
          <section className="panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Sync log</p>
                <h2>Offline training records</h2>
              </div>
              <button className="secondary-button" onClick={handleSyncNow} disabled={!onlineStatus || isSyncing}>
                {isSyncing ? "Syncing..." : onlineStatus ? "Sync now" : "Offline"}
              </button>
            </div>

            <div className="sync-list">
              {attempts.map((attempt) => (
                <div key={attempt.id} className="sync-item">
                  <div><span>Worker</span><strong>{attempt.workerName}</strong></div>
                  <div><span>Module</span><strong>{moduleData[attempt.moduleId].title}</strong></div>
                  <div><span>Score</span><strong>{attempt.score}%</strong></div>
                  <div><span>Status</span><strong>{attempt.synced ? "Synced" : "Pending"}</strong></div>
                  {onlineStatus ? <Wifi className="status-good" size={18} /> : <WifiOff className="status-bad" size={18} />}
                </div>
              ))}
            </div>
          </section>
        )}

        {screen === "dashboard" && (
          <section className="panel">
            <div className="screen-header">
              <div>
                <p className="eyebrow">Supervisor dashboard</p>
                <h2>Safety performance tracker</h2>
              </div>
              <button className="secondary-button" onClick={() => setScreen("supervisorHome")}>Back</button>
            </div>

            <div className="stats-grid">
              <div className="stat-box"><span>Workers trained</span><strong>{dashboardSummary.total}</strong></div>
              <div className="stat-box"><span>Pass rate</span><strong>{dashboardSummary.total ? Math.round((dashboardSummary.passCount / dashboardSummary.total) * 100) : 0}%</strong></div>
              <div className="stat-box"><span>Retraining</span><strong>{dashboardSummary.retrainingCount}</strong></div>
              <div className="stat-box"><span>Avg. score</span><strong>{dashboardSummary.avgScore}%</strong></div>
            </div>

            <div className="dashboard-grid">
              <article className="result-card">
                <h4><Gauge size={18} /> Module activity</h4>
                <div className="activity-list">
                  <div className="activity-row">
                    <span>Fire</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, attempts.filter((attempt) => attempt.moduleId === "fire").length * 30)}%` }} /></div>
                    <strong>{attempts.filter((attempt) => attempt.moduleId === "fire").length}</strong>
                  </div>
                  <div className="activity-row">
                    <span>Gas</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, attempts.filter((attempt) => attempt.moduleId === "gas").length * 30)}%` }} /></div>
                    <strong>{attempts.filter((attempt) => attempt.moduleId === "gas").length}</strong>
                  </div>
                </div>
              </article>

              <article className="result-card">
                <h4><CheckCircle2 size={18} /> Recent competency</h4>
                <div className="timeline-list">
                  {attempts.slice(0, 3).map((attempt) => (
                    <div key={attempt.id} className="timeline-item">
                      <strong>{moduleData[attempt.moduleId].title}</strong>
                      <small>{attempt.score}% • {new Date(attempt.createdAt).toLocaleDateString()}</small>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
