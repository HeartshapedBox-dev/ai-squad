const workers = {
  commander: { label: "Commander", room: "commander", idle: "대기 중" },
  planner: { label: "Planner", room: "planner", idle: "대기 중" },
  backend: { label: "Backend", room: "backend", idle: "대기 중" },
  database: { label: "Database", room: "database", idle: "대기 중" },
  reviewer: { label: "Reviewer", room: "reviewer", idle: "대기 중" },
  tester: { label: "Tester", room: "tester", idle: "대기 중" },
};

const demoEvents = [
  ["commander", "working", "요구사항을 기능 구현 작업으로 분류했습니다."],
  ["planner", "working", "CRUD, 통계, 목표 API로 작업을 나눴습니다."],
  ["backend", "working", "컨트롤러, 서비스, 저장소를 작성하고 있습니다."],
  ["database", "working", "Prisma schema와 migration을 검토합니다."],
  ["backend", "done", "기록 CRUD, 통계, 목표 API가 준비됐습니다."],
  ["tester", "blocked", "빌드는 통과했지만 테스트 보완이 필요합니다."],
  ["reviewer", "done", "권한 방식과 테스트 공백을 위험 요소로 기록했습니다."],
  ["commander", "done", "구현 완료. 통과 판정 전 테스트 체계 보완이 남았습니다."],
];

const timeline = document.querySelector("#timeline");
const refreshButton = document.querySelector("#refreshRun");
const demoButton = document.querySelector("#runDemo");
const runStatus = document.querySelector("#runStatus");
const runTitle = document.querySelector("#runTitle");
const reportTitle = document.querySelector("#reportTitle");
const reportText = document.querySelector("#reportText");
let demoTimer = null;
let pollTimer = null;

function agentElement(worker) {
  return document.querySelector(`[data-agent="${worker}"]`);
}

function clearAgentClasses(agent) {
  agent.classList.remove(
    "to-planner",
    "to-backend",
    "to-database",
    "to-reviewer",
    "to-tester",
    "to-commander",
    "working",
    "assigned",
    "done",
    "blocked",
    "inactive",
  );
}

function setAgentState(worker, status, message) {
  const config = workers[worker];
  const agent = agentElement(worker);
  if (!config || !agent) return;

  clearAgentClasses(agent);
  agent.classList.add(`to-${config.room}`, status);
  agent.querySelector(".bubble").textContent = message;
}

function resetAgents() {
  Object.entries(workers).forEach(([id, worker]) => {
    const agent = agentElement(id);
    clearAgentClasses(agent);
    agent.className = `agent ${id}`;
    agent.querySelector(".bubble").textContent = worker.idle;
  });
}

function setStatus(text, className = "") {
  runStatus.textContent = text;
  runStatus.className = className ? `status-pill ${className}` : "status-pill";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addTimelineItem({ title, message, detail }, index) {
  const item = document.createElement("li");
  item.innerHTML = `
    <span class="mark">${index + 1}</span>
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
      ${detail ? `<code>${escapeHtml(detail)}</code>` : ""}
    </div>
  `;
  timeline.appendChild(item);
}

function stopDemo() {
  window.clearTimeout(demoTimer);
  demoTimer = null;
}

async function loadLatestRun() {
  stopDemo();

  try {
    const response = await fetch("/api/runs/latest", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderRun(data);
  } catch (error) {
    renderApiUnavailable(error);
  }
}

function renderApiUnavailable(error) {
  resetAgents();
  timeline.innerHTML = "";
  runTitle.textContent = "라이브 서버 연결 필요";
  setStatus("Offline", "blocked");
  reportTitle.textContent = "정적 파일로 열린 상태";
  reportText.textContent =
    "실제 .squad-runs를 읽으려면 `node town/server.mjs`로 실행한 뒤 http://127.0.0.1:4180 에 접속해야 합니다.";
  addTimelineItem(
    {
      title: "API 연결 실패",
      message: "브라우저가 /api/runs/latest 응답을 받지 못했습니다.",
      detail: error.message,
    },
    0,
  );
}

function renderRun(data) {
  resetAgents();
  timeline.innerHTML = "";

  if (!data.run) {
    runTitle.textContent = "아직 squad run 없음";
    setStatus("Idle");
    reportTitle.textContent = "작업 대기 중";
    reportText.textContent = ".squad-runs 아래에 manifest.json이 있는 run이 없습니다.";
    return;
  }

  const resultByRole = new Map(data.results.map((result) => [result.role, result]));
  const roles = data.roles.filter((role) => workers[role]);
  const doneCount = roles.filter((role) => resultByRole.has(role)).length;
  const isDone = roles.length > 0 && doneCount === roles.length;

  runTitle.textContent = `${data.run.mode} · ${data.run.id}`;
  setStatus(isDone ? "Done" : "Running", isDone ? "done" : "running");

  Object.keys(workers).forEach((role) => {
    const assigned = roles.includes(role);
    const result = resultByRole.get(role);

    if (!assigned) {
      setAgentState(role, "inactive", "이번 run 제외");
      return;
    }

    if (result) {
      setAgentState(role, "done", result.preview || "결과 제출 완료");
      return;
    }

    setAgentState(role, "assigned", "작업 배정됨");
  });

  addTimelineItem(
    {
      title: "Run 생성",
      message: data.run.task || "작업 내용 없음",
      detail: data.run.path,
    },
    0,
  );

  roles.forEach((role, index) => {
    const result = resultByRole.get(role);
    addTimelineItem(
      {
        title: result ? `${workers[role].label} 결과 제출` : `${workers[role].label} 대기`,
        message: result?.preview || "아직 results/*.md 파일이 없습니다.",
        detail: result?.file || `${role}.md`,
      },
      index + 1,
    );
  });

  reportTitle.textContent = isDone
    ? "모든 worker 결과 제출 완료"
    : `결과 대기 중 ${doneCount}/${roles.length}`;
  reportText.textContent = isDone
    ? "Commander가 취합할 수 있는 결과 파일이 모두 준비됐습니다."
    : "worker가 results/*.md를 제출하면 캐릭터가 완료 상태로 바뀝니다.";
}

function runDemo() {
  stopDemo();
  resetAgents();
  timeline.innerHTML = "";
  runTitle.textContent = "데모 재생 중";
  setStatus("Demo", "running");
  reportTitle.textContent = "데모 모드";
  reportText.textContent = "실제 run 연결 전 동작 흐름을 보여줍니다.";

  let index = 0;
  const next = () => {
    const event = demoEvents[index];
    if (!event) {
      setStatus("Done", "done");
      reportTitle.textContent = "데모 완료";
      reportText.textContent =
        "실제 연결은 새로고침 버튼으로 최신 .squad-runs 상태를 불러옵니다.";
      return;
    }

    const [role, status, message] = event;
    setAgentState(role, status, message);
    addTimelineItem(
      {
        title: `${workers[role].label} ${status}`,
        message,
      },
      index,
    );
    index += 1;
    demoTimer = window.setTimeout(next, 850);
  };

  next();
}

refreshButton.addEventListener("click", loadLatestRun);
demoButton.addEventListener("click", runDemo);

loadLatestRun();
pollTimer = window.setInterval(loadLatestRun, 2000);
window.addEventListener("beforeunload", () => {
  window.clearInterval(pollTimer);
  stopDemo();
});
