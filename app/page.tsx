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
import * as THREE from "three";

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
type FireInteractionStep = "search" | "pickup" | "pin" | "aim" | "spray" | "complete";
type GasInteractionStep = "detect" | "ppe" | "evacuate" | "complete";
type GasInteractionAction = Exclude<GasInteractionStep, "complete">;
type GasInteractionFeedback = { status: "correct" | "incorrect"; message: string };
type GasTrainingPerformance = {
  completionTimeSeconds: number;
  incorrectActions: number;
  successfulCompletion: boolean;
};
type FireTrainingPerformance = {
  completionTimeSeconds: number;
  incorrectActions: number;
  extinguished: boolean;
};

const formatFireCompletionTime = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const formatGasCompletionTime = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

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
  const [fireInteractionStep, setFireInteractionStep] = useState<FireInteractionStep>("search");
  const [fireAimValid, setFireAimValid] = useState(false);
  const [firePerformance, setFirePerformance] = useState<FireTrainingPerformance | null>(null);
  const [fireCompletionContinued, setFireCompletionContinued] = useState(false);
  const [fireTrainingRunId, setFireTrainingRunId] = useState(0);
  const [gasInteractionStep, setGasInteractionStep] = useState<GasInteractionStep>("detect");
  const [gasInteractionFeedback, setGasInteractionFeedback] = useState<GasInteractionFeedback | null>(null);
  const [gasPerformance, setGasPerformance] = useState<GasTrainingPerformance | null>(null);
  const [firePinDrag, setFirePinDrag] = useState(false);
  const fireInteractionStepRef = useRef<FireInteractionStep>("search");
  const fireAimValidRef = useRef(false);
  const fireExerciseStartedAtRef = useRef<number | null>(null);
  const fireIncorrectActionsRef = useRef(0);
  const gasExerciseStartedAtRef = useRef<number | null>(null);
  const gasIncorrectActionsRef = useRef(0);
  const firePinDragRef = useRef(false);
  const startFireSprayRef = useRef<(() => boolean) | null>(null);
  const stopFireSprayRef = useRef<(() => void) | null>(null);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const nativeCameraBoxRef = useRef<HTMLDivElement | null>(null);
  const threeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const certificateRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const recordFireIncorrectAction = () => {
    fireIncorrectActionsRef.current += 1;
  };

  const handleGasAction = (action: GasInteractionAction) => {
    if (gasInteractionStep === "complete") return;

    if (action !== gasInteractionStep) {
      gasIncorrectActionsRef.current += 1;
      const message = gasInteractionStep === "detect"
        ? "Incorrect. Acknowledge the methane alarm first."
        : gasInteractionStep === "ppe"
          ? action === "detect" ? "Incorrect. The leak is identified. Confirm the respirator next." : "Incorrect. Confirm the respirator before evacuation."
          : "Incorrect. The leak and PPE are confirmed. Evacuate upwind next.";
      setGasInteractionFeedback({ status: "incorrect", message });
      return;
    }

    const nextStep: GasInteractionStep = action === "detect" ? "ppe" : action === "ppe" ? "evacuate" : "complete";
    const message = action === "detect"
      ? "Correct. Methane alarm acknowledged."
      : action === "ppe"
        ? "Correct. Respirator confirmed."
        : "Correct. The gas hazard is isolated and the crew is at muster.";
    if (action === "evacuate") {
      const completedAt = performance.now();
      const startedAt = gasExerciseStartedAtRef.current ?? completedAt;
      setGasPerformance({
        completionTimeSeconds: Math.floor(Math.max(0, completedAt - startedAt) / 1000),
        incorrectActions: gasIncorrectActionsRef.current,
        successfulCompletion: true,
      });
    }
    setGasInteractionStep(nextStep);
    setGasInteractionFeedback({ status: "correct", message });
  };

  useEffect(() => {
    fireInteractionStepRef.current = fireInteractionStep;
  }, [fireInteractionStep]);

  useEffect(() => {
    firePinDragRef.current = firePinDrag;
  }, [firePinDrag]);

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
        left: rect.left * density,
        top: rect.top * density,
        width: rect.width * density,
        height: rect.height * density,
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

  useEffect(() => {
    if (screen !== "scenario" || activeModuleId !== "fire") return;

    const fireAlreadyExtinguished = fireInteractionStepRef.current === "complete";
    const canvas = threeCanvasRef.current;
    const container = nativeCameraBoxRef.current;
    if (!canvas || !container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-2.2, 2.2, 1.45, -1.45, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(3, 4, 6);
    scene.add(key);

    const red = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.35, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5, metalness: 0.1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8bec7, roughness: 0.25, metalness: 0.85 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.4, metalness: 0.2 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.8 });

    const extinguisher = new THREE.Group();
    extinguisher.name = "extinguisher";

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 1.75, 32), red);
    body.position.y = -0.25;
    extinguisher.add(body);

    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.29, 0.25, 24), metal);
    top.position.y = 0.75;
    extinguisher.add(top);

    const valve = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.15, 0.2), dark);
    valve.position.set(0, 0.9, 0);
    extinguisher.add(valve);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 0.15), dark);
    handle.position.set(0, 1.02, 0);
    extinguisher.add(handle);

    const handleStem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), dark);
    handleStem.position.set(0.19, 0.9, 0);
    extinguisher.add(handleStem);

    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.024, 10, 20), yellow);
    pin.name = "safetyPin";
    pin.rotation.x = Math.PI / 2;
    pin.position.set(-0.21, 0.9, 0.14);
    extinguisher.add(pin);

    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.25, 0.77, 0),
      new THREE.Vector3(0.58, 0.6, 0),
      new THREE.Vector3(0.72, 0.15, 0),
      new THREE.Vector3(0.6, -0.18, 0),
    ]);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 24, 0.06, 12, false), dark);
    extinguisher.add(hose);

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.42, 20), dark);
    nozzle.name = "nozzle";
    nozzle.rotation.z = -0.55;
    nozzle.position.set(0.62, -0.27, 0);
    extinguisher.add(nozzle);

    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.035, 32), white);
    label.rotation.x = Math.PI / 2;
    label.rotation.z = Math.PI / 2;
    label.position.set(0, -0.2, 0.56);
    extinguisher.add(label);

    extinguisher.scale.setScalar(0.9);
    extinguisher.position.set(0.95, -0.15, 0);
    extinguisher.rotation.set(0, -0.18, 0);
    scene.add(extinguisher);

    const fireGroup = new THREE.Group();
    fireGroup.name = "fireTarget";
    fireGroup.position.set(-0.9, 0.05, 0);

    const fireOuterMaterial = new THREE.MeshBasicMaterial({ color: 0xff4d00, transparent: true, opacity: 0.96 });
    const fireInnerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 1 });
    const fireCoreMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });

    const fireOuter = new THREE.Mesh(new THREE.SphereGeometry(0.48, 24, 24), fireOuterMaterial);
    fireOuter.scale.set(0.7, 1.25, 0.55);
    fireGroup.add(fireOuter);

    const fireInner = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 20), fireInnerMaterial);
    fireInner.scale.set(0.7, 1.35, 0.6);
    fireInner.position.set(0, -0.08, 0.2);
    fireGroup.add(fireInner);

    const fireCore = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), fireCoreMaterial);
    fireCore.position.set(0, -0.12, 0.34);
    fireGroup.add(fireCore);

    const fireLight = new THREE.PointLight(0xff6500, 3.5, 3);
    fireLight.position.set(0, 0, 0.4);
    fireGroup.add(fireLight);
    fireGroup.visible = !fireAlreadyExtinguished;
    scene.add(fireGroup);

    const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    const reticle = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 32), reticleMaterial);
    reticle.position.set(-0.9, 0.05, 0.45);
    reticle.visible = !fireAlreadyExtinguished;
    scene.add(reticle);

    const sprayGroup = new THREE.Group();
    sprayGroup.visible = false;
    scene.add(sprayGroup);

    const sprayMaterial = new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.8 });
    const sprayParticles: THREE.Mesh[] = [];
    for (let i = 0; i < 45; i++) {
      const particle = new THREE.Mesh(new THREE.SphereGeometry(0.018 + Math.random() * 0.028, 8, 8), sprayMaterial);
      particle.visible = false;
      sprayGroup.add(particle);
      sprayParticles.push(particle);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const nozzleWorld = new THREE.Vector3();
    const fireWorld = new THREE.Vector3();
    const nozzleScreen = new THREE.Vector3();
    const fireScreen = new THREE.Vector3();

    let dragStartX = 0;
    let dragStartY = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let activePointerId: number | null = null;
    let draggingExtinguisher = false;
    let draggingPin = false;
    let sprayStartTime = 0;
    let sprayLastTime = 0;
    let sprayActive = false;
    let fireHealth = fireAlreadyExtinguished ? 0 : 1;

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const viewHeight = 2.9;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.left = -(viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.updateProjectionMatrix();
    };

    const setPointerFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const getHit = (event: PointerEvent) => {
      setPointerFromEvent(event);
      const hits = raycaster.intersectObject(extinguisher, true);
      return hits[0]?.object ?? null;
    };

    const hitIsExtinguisher = (object: THREE.Object3D | null) => {
      if (!object) return false;
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current === extinguisher) return true;
        current = current.parent;
      }
      return false;
    };

    const hitIsPin = (object: THREE.Object3D | null) => {
      if (!object) return false;
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current === pin) return true;
        current = current.parent;
      }
      return false;
    };

    const checkAim = () => {
      nozzle.getWorldPosition(nozzleWorld);
      fireGroup.getWorldPosition(fireWorld);
      nozzleScreen.copy(nozzleWorld).project(camera);
      fireScreen.copy(fireWorld).project(camera);

      const distance = Math.hypot(nozzleScreen.x - fireScreen.x, nozzleScreen.y - fireScreen.y);
      const aligned = distance < 0.28;
      reticleMaterial.color.set(aligned ? 0x35e06f : 0xffb000);
      reticle.scale.setScalar(aligned ? 1.15 : 1);
      if (fireAimValidRef.current !== aligned) {
        fireAimValidRef.current = aligned;
        setFireAimValid(aligned);
      }
      return aligned;
    };

    const startSpray = () => {
      if (sprayActive || fireInteractionStepRef.current !== "aim" || fireHealth <= 0 || !fireGroup.visible || !checkAim()) return false;
      sprayActive = true;
      sprayStartTime = performance.now();
      sprayLastTime = sprayStartTime;
      sprayGroup.visible = true;
      sprayParticles.forEach((particle) => { particle.visible = true; });
      setFireInteractionStep("spray");
      return true;
    };

    const stopSpray = () => {
      if (!sprayActive) return;
      sprayActive = false;
      sprayGroup.visible = false;
      sprayParticles.forEach((particle) => { particle.visible = false; });
      if (fireHealth > 0 && fireGroup.visible) setFireInteractionStep("aim");
    };

    startFireSprayRef.current = startSpray;
    stopFireSprayRef.current = stopSpray;

    const updateSpray = (time: number) => {
      if (!sprayActive || !sprayGroup.visible) return;
      if (!checkAim()) {
        stopSpray();
        return;
      }

      nozzle.getWorldPosition(nozzleWorld);
      fireGroup.getWorldPosition(fireWorld);
      const direction = new THREE.Vector3().subVectors(fireWorld, nozzleWorld).normalize();

      sprayParticles.forEach((particle, index) => {
        const progress = ((time - sprayStartTime) * 0.0018 + index * 0.028) % 1;
        particle.position.copy(nozzleWorld);
        particle.position.add(direction.clone().multiplyScalar(progress * 1.8));
        particle.position.x += Math.sin(time * 0.009 + index) * 0.045 * progress;
        particle.position.y += Math.cos(time * 0.008 + index) * 0.045 * progress;
      });

      const frameDelta = Math.min(Math.max(time - sprayLastTime, 0), 50);
      sprayLastTime = time;
      fireHealth = Math.max(0, fireHealth - frameDelta / 1800);
      fireGroup.scale.setScalar(fireHealth);
      fireOuterMaterial.opacity = fireHealth * 0.96;
      fireInnerMaterial.opacity = fireHealth;
      fireCoreMaterial.opacity = fireHealth;
      fireLight.intensity = fireHealth * 3.5;

      if (fireHealth <= 0) {
        sprayActive = false;
        sprayGroup.visible = false;
        fireGroup.visible = false;
        reticle.visible = false;
        sprayParticles.forEach((particle) => { particle.visible = false; });
        const completedAt = performance.now();
        const startedAt = fireExerciseStartedAtRef.current ?? completedAt;
        setFirePerformance({
          completionTimeSeconds: Math.floor(Math.max(0, completedAt - startedAt) / 1000),
          incorrectActions: fireIncorrectActionsRef.current,
          extinguished: true,
        });
        setFireCompletionContinued(false);
        setFireInteractionStep("complete");
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (activePointerId !== null) return;

      const step = fireInteractionStepRef.current;
      const hit = getHit(event);

      if (step === "search" || step === "pickup") {
        if (hitIsExtinguisher(hit)) {
          activePointerId = event.pointerId;
          draggingExtinguisher = true;
          dragStartX = event.clientX;
          dragStartY = event.clientY;
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          canvas.setPointerCapture?.(event.pointerId);
          setFireInteractionStep("pickup");
        } else {
          recordFireIncorrectAction();
        }
        return;
      }

      if (step === "pin") {
        if (hitIsPin(hit)) {
          activePointerId = event.pointerId;
          draggingPin = true;
          dragStartX = event.clientX;
          dragStartY = event.clientY;
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          canvas.setPointerCapture?.(event.pointerId);
        } else {
          recordFireIncorrectAction();
        }
        return;
      }

      if (step === "aim") {
        if (hitIsExtinguisher(hit)) {
          activePointerId = event.pointerId;
          draggingExtinguisher = true;
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          canvas.setPointerCapture?.(event.pointerId);
        } else {
          recordFireIncorrectAction();
        }
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return;

      const step = fireInteractionStepRef.current;
      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;

      if (draggingPin && step === "pin") {
        const distance = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);
        pin.position.x = -0.21 + THREE.MathUtils.clamp((event.clientX - dragStartX) / 100, -0.7, 0.9);
        pin.position.y = 0.9 - THREE.MathUtils.clamp((event.clientY - dragStartY) / 100, -0.5, 0.5);
        if (distance > 32) {
          pin.visible = false;
          firePinDragRef.current = false;
          setFirePinDrag(false);
          setFireInteractionStep("aim");
        } else {
          recordFireIncorrectAction();
        }
        return;
      }

      if (draggingExtinguisher && (step === "pickup" || step === "aim")) {
        const rect = canvas.getBoundingClientRect();
        const worldPerPixelX = (camera.right - camera.left) / Math.max(rect.width, 1);
        const worldPerPixelY = (camera.top - camera.bottom) / Math.max(rect.height, 1);
        extinguisher.position.x += dx * worldPerPixelX;
        extinguisher.position.y -= dy * worldPerPixelY;
        extinguisher.position.x = THREE.MathUtils.clamp(extinguisher.position.x, -1.45, 1.45);
        extinguisher.position.y = THREE.MathUtils.clamp(extinguisher.position.y, -1.0, 1.0);
        if (step === "aim") checkAim();
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return;

      const step = fireInteractionStepRef.current;
      const distance = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);

      if (draggingPin) {
        draggingPin = false;
        activePointerId = null;
        canvas.releasePointerCapture?.(event.pointerId);
        if (distance > 32) {
          pin.visible = false;
          firePinDragRef.current = false;
          setFirePinDrag(false);
          setFireInteractionStep("aim");
        }
        return;
      }

      if (draggingExtinguisher) {
        draggingExtinguisher = false;
        activePointerId = null;
        canvas.releasePointerCapture?.(event.pointerId);

        if (step === "pickup") {
          setFireInteractionStep("pin");
          return;
        }

        if (step === "aim" && !checkAim()) recordFireIncorrectAction();
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let animationFrame = 0;
    const animate = (time: number) => {
      const step = fireInteractionStepRef.current;

      if (step === "search") {
        extinguisher.rotation.z = Math.sin(time * 0.0012) * 0.018;
        extinguisher.position.y = -0.15 + Math.sin(time * 0.0015) * 0.025;
      }

      if (step === "aim") checkAim();
      if (step === "spray") updateSpray(time);

      if (fireGroup.visible) {
        fireOuter.rotation.z = Math.sin(time * 0.002) * 0.08;
        fireOuter.scale.y = 1.25 + Math.sin(time * 0.009) * 0.1;
        fireInner.scale.y = 1.35 + Math.sin(time * 0.011 + 1) * 0.08;
        fireLight.intensity = fireHealth * (3.2 + Math.sin(time * 0.012) * 0.45);
      }

      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      startFireSprayRef.current = null;
      stopFireSprayRef.current = null;
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      renderer.dispose();
      red.dispose();
      dark.dispose();
      metal.dispose();
      yellow.dispose();
      white.dispose();
      fireOuterMaterial.dispose();
      fireInnerMaterial.dispose();
      fireCoreMaterial.dispose();
      reticleMaterial.dispose();
      sprayMaterial.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    };
  }, [screen, activeModuleId, scenarioIndex, fireTrainingRunId]);

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
    if (moduleId === "gas") {
      setGasInteractionStep("detect");
      setGasInteractionFeedback(null);
      setGasPerformance(null);
      gasExerciseStartedAtRef.current = null;
      gasIncorrectActionsRef.current = 0;
    }
    setScenarioIndex(0);
    setAnswers([]);
    setResultSummary(null);
    setFirePerformance(null);
    setFireCompletionContinued(false);
    fireExerciseStartedAtRef.current = null;
    fireIncorrectActionsRef.current = 0;
    fireAimValidRef.current = false;
    setFireAimValid(false);
    setFireInteractionStep(moduleId === "fire" ? "search" : "search");
    setFirePinDrag(false);
    setScreen("briefing");
    speak(moduleData[moduleId].briefing);
  };

  const retryFireTraining = () => {
    setActiveModuleId("fire");
    setScenarioIndex(0);
    setAnswers([]);
    setResultSummary(null);
    setFirePerformance(null);
    setFireCompletionContinued(false);
    fireExerciseStartedAtRef.current = performance.now();
    fireIncorrectActionsRef.current = 0;
    fireInteractionStepRef.current = "search";
    setFireInteractionStep("search");
    fireAimValidRef.current = false;
    setFireAimValid(false);
    firePinDragRef.current = false;
    setFirePinDrag(false);
    setFireTrainingRunId((runId) => runId + 1);
    setScreen("scenario");
  };

  const retryGasTraining = () => {
    setActiveModuleId("gas");
    setScenarioIndex(0);
    setAnswers([]);
    setResultSummary(null);
    setGasInteractionStep("detect");
    setGasInteractionFeedback(null);
    setGasPerformance(null);
    gasExerciseStartedAtRef.current = performance.now();
    gasIncorrectActionsRef.current = 0;
    setScreen("scenario");
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
              <button className="primary-button" onClick={() => {
                if (activeModuleId === "fire") {
                  fireExerciseStartedAtRef.current = performance.now();
                  fireIncorrectActionsRef.current = 0;
                  setFirePerformance(null);
                } else if (activeModuleId === "gas") {
                  gasExerciseStartedAtRef.current = performance.now();
                  gasIncorrectActionsRef.current = 0;
                  setGasPerformance(null);
                  setGasInteractionFeedback(null);
                }
                setScreen("scenario");
                speak(`${currentModule.title} scenario started.`);
              }}>
                Enter scenario <ArrowRight size={18} />
              </button>
            </div>
          </section>
        )}

        {screen === "scenario" && (
          <section className="panel scenario-panel">
            {activeModuleId === "fire" && fireInteractionStep === "complete" && firePerformance && !fireCompletionContinued ? (
              <div className="fire-completion">
                <p className="eyebrow eyebrow-success">Fire Safety Training</p>
                <div className="fire-completion-header">
                  <div>
                    <h2 className="fire-completion-title">FIRE SAFETY TRAINING COMPLETE</h2>
                    <p className="fire-completion-status">
                      {firePerformance.extinguished ? "The fire was successfully extinguished." : "The fire was not extinguished."}
                    </p>
                  </div>
                  <span className="pill pill-success">COMPLETE</span>
                </div>

                <div className="fire-completion-metrics">
                  <div className="fire-completion-metric">
                    <span>Completion status</span>
                    <strong>{firePerformance.extinguished ? "Successful" : "Not extinguished"}</strong>
                  </div>
                  <div className="fire-completion-metric">
                    <span>Completion time</span>
                    <strong>{formatFireCompletionTime(firePerformance.completionTimeSeconds)}</strong>
                  </div>
                  <div className="fire-completion-metric">
                    <span>Mistakes / incorrect actions</span>
                    <strong>{firePerformance.incorrectActions}</strong>
                  </div>
                </div>

                <div className="fire-safety-takeaway">
                  <p className="eyebrow eyebrow-success">Safety takeaway</p>
                  <p>Aim at the base of the fire, sweep side to side, and keep a clear exit route.</p>
                </div>

                <div className="button-row fire-completion-actions">
                  <button className="secondary-button" onClick={retryFireTraining}>Retry Training</button>
                  <button className="primary-button" onClick={() => setFireCompletionContinued(true)}>Continue to assessment</button>
                </div>
              </div>
            ) : (
              <>
                <div className="screen-header compact-header">
                  <div>
                    <p className="eyebrow">Live assessment</p>
                    <h3>{currentModule.title}</h3>
                  </div>
                  <span className="pill pill-success">Step {scenarioIndex + 1}/{currentModule.scenarios.length}</span>
                </div>

                <div className={`scenario-grid${activeModuleId === "gas" ? " gas-scenario-grid" : ""}`}>
              <div className="scene-panel">
                <div className="scene-header">
                  <span>{activeModuleId === "gas" ? `Gas incident · ${currentScenario.title}` : "Analyzing surroundings"}</span>
                  <MapPinned size={15} />
                </div>

                <div
                  ref={nativeCameraBoxRef}
                  className="scene-box camera-scene-box"
                  style={{ background: "transparent", position: "relative", overflow: "hidden" }}
                >
                  {activeModuleId === "fire" && (
                    <canvas
                      ref={threeCanvasRef}
                      aria-label="3D fire extinguisher AR object"
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        display: "block",
                        zIndex: 20,
                        pointerEvents: "auto",
                        touchAction: "none",
                      }}
                    />
                  )}
                  {activeModuleId === "gas" && (
                    <div className={`gas-incident-overlay${gasInteractionStep === "complete" ? " gas-incident-overlay-complete" : ""}`} aria-label="Gas incident at the tank farm">
                      <div className="gas-incident-header">
                        <div className={`gas-alarm-status${gasInteractionStep === "complete" ? " gas-alarm-status-complete" : ""}`}>
                          <span className={`gas-alarm-indicator${gasInteractionStep === "complete" ? " gas-alarm-indicator-stopped" : ""}`} aria-hidden="true" />
                          <span>
                            <strong>{gasInteractionStep === "complete" ? "GAS HAZARD STOPPED" : gasInteractionStep === "evacuate" ? "PPE CONFIRMED" : gasInteractionStep === "ppe" ? "LEAK IDENTIFIED" : "GAS ALARM ACTIVE"}</strong>
                            <small>{gasInteractionStep === "complete" ? "Scenario complete · crew at muster" : gasInteractionStep === "evacuate" ? "Move to the muster point" : "Methane · Tank farm"}</small>
                          </span>
                        </div>
                        <div className={`gas-detector-readout${gasInteractionStep === "complete" ? " gas-detector-readout-cleared" : ""}`}>
                          <Gauge size={20} aria-hidden="true" />
                          <span><strong>DETECTOR</strong><small>{gasInteractionStep === "complete" ? "CLEARED" : "ALARM"}</small></span>
                        </div>
                      </div>

                      <div className="gas-site-plot" aria-label="Tank access, leak plume, and upwind muster route">
                        <div className="gas-tank-marker">
                          <span className="gas-tank-object" aria-hidden="true" />
                          <span className="gas-site-label">Tank access</span>
                        </div>
                        {gasInteractionStep !== "complete" && <div className="gas-leak-plume" aria-hidden="true"><i /><i /><i /></div>}
                        <div className={`gas-leak-label${gasInteractionStep === "complete" ? " gas-leak-label-stopped" : ""}`}>
                          {gasInteractionStep === "complete" ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
                          <span>{gasInteractionStep === "complete" ? "SOURCE ISOLATED" : "METHANE LEAK"}</span>
                        </div>
                        <button
                          type="button"
                          className={`gas-upwind-route gas-route-control${gasInteractionStep === "evacuate" ? " gas-route-control-ready" : gasInteractionStep === "complete" ? " gas-route-control-complete" : " gas-route-control-awaiting"}`}
                          aria-label={gasInteractionStep === "evacuate" ? "Tap to evacuate upwind to the muster point" : gasInteractionStep === "complete" ? "Upwind evacuation complete" : "Complete gas detection and PPE steps before evacuation"}
                          aria-pressed={gasInteractionStep === "complete"}
                          disabled={gasInteractionStep !== "evacuate"}
                          onClick={() => handleGasAction("evacuate")}
                        >
                          <MapPinned size={16} aria-hidden="true" />
                          <span>{gasInteractionStep === "complete" ? "PERSONNEL SAFE" : gasInteractionStep === "evacuate" ? "TAP TO EVACUATE UPWIND" : "UPWIND MUSTER POINT"}</span>
                          <ArrowRight size={18} aria-hidden="true" />
                        </button>
                      </div>

                      <div className="gas-response-equipment">
                        <button
                          type="button"
                          className={`gas-equipment-item gas-equipment-control${gasInteractionStep === "detect" ? " gas-equipment-control-ready" : " gas-equipment-control-complete"}`}
                          aria-label={gasInteractionStep === "detect" ? "Tap gas detector to identify the leak" : "Gas leak identified"}
                          aria-pressed={gasInteractionStep !== "detect"}
                          disabled={gasInteractionStep === "complete"}
                          onClick={() => handleGasAction("detect")}
                        >
                          <Gauge size={17} aria-hidden="true" />
                          <span>Gas detector</span>
                          <strong>{gasInteractionStep === "detect" ? "Tap to identify" : "Leak identified"}</strong>
                        </button>
                        <button
                          type="button"
                          className={`gas-equipment-item gas-equipment-control${gasInteractionStep === "ppe" ? " gas-equipment-control-ready" : gasInteractionStep === "evacuate" || gasInteractionStep === "complete" ? " gas-equipment-control-complete" : " gas-equipment-control-awaiting"}`}
                          aria-label={gasInteractionStep === "ppe" ? "Tap respirator to confirm required protective equipment" : gasInteractionStep === "evacuate" || gasInteractionStep === "complete" ? "Respirator confirmed" : "Identify the gas leak before selecting the respirator"}
                          aria-pressed={gasInteractionStep === "evacuate" || gasInteractionStep === "complete"}
                          disabled={gasInteractionStep === "complete"}
                          onClick={() => handleGasAction("ppe")}
                        >
                          <ShieldCheck size={17} aria-hidden="true" />
                          <span>Respirator</span>
                          <strong>{gasInteractionStep === "ppe" ? "Tap to confirm PPE" : gasInteractionStep === "evacuate" || gasInteractionStep === "complete" ? "PPE confirmed" : "Required PPE"}</strong>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {activeModuleId === "gas" && (
                  <div className="gas-interaction-task" role="status" aria-live="polite">
                    <span>{gasInteractionStep === "detect" ? "REQUIRED ACTION · 1 OF 3" : gasInteractionStep === "ppe" ? "REQUIRED ACTION · 2 OF 3" : gasInteractionStep === "evacuate" ? "REQUIRED ACTION · 3 OF 3" : "SCENARIO COMPLETE"}</span>
                    <strong>{gasInteractionStep === "detect" ? "Identify the gas leak" : gasInteractionStep === "ppe" ? "Confirm protective equipment" : gasInteractionStep === "evacuate" ? "Evacuate upwind" : "Gas hazard stopped"}</strong>
                    {gasInteractionFeedback && <p className={`gas-action-feedback gas-action-feedback-${gasInteractionFeedback.status}`} aria-live="polite">{gasInteractionFeedback.message}</p>}
                    <p className="gas-next-action"><strong>{gasInteractionStep === "complete" ? "Status:" : "Next:"}</strong> {gasInteractionStep === "detect" ? "Tap the gas detector." : gasInteractionStep === "ppe" ? "Tap the respirator." : gasInteractionStep === "evacuate" ? "Tap the upwind muster point." : "Crew safe at muster. Maintain isolation until all-clear."}</p>
                    {gasInteractionStep === "complete" && gasPerformance && (
                      <div className="gas-performance-results" aria-label="Gas training performance">
                        <strong>Training performance</strong>
                        <div className="gas-performance-grid">
                          <div><span>Completion time</span><b>{formatGasCompletionTime(gasPerformance.completionTimeSeconds)}</b></div>
                          <div><span>Incorrect actions</span><b>{gasPerformance.incorrectActions}</b></div>
                          <div><span>Successful</span><b>{gasPerformance.successfulCompletion ? "Yes" : "No"}</b></div>
                        </div>
                        <button type="button" className="gas-retry-button" onClick={retryGasTraining}>Retry Training</button>
                      </div>
                    )}
                  </div>
                )}
                {activeModuleId === "fire" && (
                  <div className="fire-training-status">
                    <div className="fire-training-status-copy">
                      <strong className="fire-training-instruction">
                        {fireInteractionStep === "search" && "1. Locate the fire."}
                        {fireInteractionStep === "pickup" && "2. Pick up the extinguisher."}
                        {fireInteractionStep === "pin" && "3. Pull the safety pin."}
                        {fireInteractionStep === "aim" && "4. Aim the nozzle at the base of the fire."}
                        {fireInteractionStep === "spray" && "5. Press and hold to spray."}
                        {fireInteractionStep === "complete" && "Fire extinguished"}
                      </strong>
                      <span className="fire-training-detail">
                        {fireInteractionStep === "search" ? "Identify the active fire in the scene." : fireInteractionStep === "pickup" ? "Select the extinguisher to continue." : fireInteractionStep === "pin" ? "Pull outward to release the pin." : fireInteractionStep === "aim" ? (fireAimValid ? "On target. Hold the spray control." : "Adjust until the nozzle points at the fire base.") : fireInteractionStep === "spray" ? "6. Sweep the spray across the fire until extinguished." : fireInteractionStep === "complete" ? "Fire hazard cleared. Response complete." : ""}
                      </span>
                    </div>
                    {fireInteractionStep === "aim" || fireInteractionStep === "spray" ? (
                      <button
                        type="button"
                        className={`fire-spray-control${fireInteractionStep === "spray" ? " fire-spray-control-active" : fireAimValid ? " fire-spray-control-ready" : " fire-spray-control-disabled"}`}
                        aria-label={fireInteractionStep === "spray" ? "Release to stop spraying" : "Hold to spray"}
                        disabled={fireInteractionStep === "aim" && !fireAimValid}
                        onPointerDown={(event) => {
                          if (event.button !== 0 || !startFireSprayRef.current?.()) return;
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerUp={() => stopFireSprayRef.current?.()}
                        onPointerCancel={() => stopFireSprayRef.current?.()}
                        onLostPointerCapture={() => stopFireSprayRef.current?.()}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        {fireInteractionStep === "spray" ? "Release to stop" : "Hold to spray"}
                      </button>
                    ) : (
                      <span className={`fire-training-stage${fireInteractionStep === "complete" ? " fire-training-stage-complete" : ""}`}>
                        {fireInteractionStep === "complete" ? "DONE" : fireInteractionStep.toUpperCase()}
                      </span>
                    )}
                  </div>
                )}
                <p className="scene-copy">{currentScenario.context}</p>
                {activeModuleId === "fire" && fireInteractionStep === "complete" && firePerformance && (
                  <section
                    className="fire-performance-summary"
                    aria-live="polite"
                  >
                    <strong className="fire-performance-heading">Training performance</strong>
                    <div className="fire-performance-metrics">
                      <div className="fire-performance-item">
                        <span>Completion time</span>
                        <strong>{formatFireCompletionTime(firePerformance.completionTimeSeconds)}</strong>
                      </div>
                      <div className="fire-performance-item">
                        <span>Incorrect actions</span>
                        <strong>{firePerformance.incorrectActions}</strong>
                      </div>
                      <div className="fire-performance-item">
                        <span>Fire extinguished</span>
                        <strong>{firePerformance.extinguished ? "Yes" : "No"}</strong>
                      </div>
                    </div>
                  </section>
                )}
                {activeModuleId === "fire" && fireInteractionStep === "search" && (
                  <button
                    type="button"
                    className="fire-detect-control"
                    onClick={() => setFireInteractionStep("pickup")}
                  >
                    Detect extinguisher → interact
                  </button>
                )}
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
              </>
            )}
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
