#include <windows.h>
#include <dwmapi.h>
#include <shellapi.h>

#include <algorithm>
#include <atomic>
#include <charconv>
#include <iostream>
#include <iterator>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace {
constexpr UINT kCommandMessage = WM_APP + 1;
constexpr UINT kRefreshMessage = WM_APP + 2;
constexpr UINT kRefreshDelayMs = 90;

struct WindowInfo {
  HWND hwnd{};
  std::wstring title;
  DWORD processId{};
  std::wstring processName;
  std::wstring executablePath;
  bool minimized{};
};

struct Command {
  std::string verb;
  std::string requestId;
  std::string argument;
};

DWORD g_mainThreadId = 0;
std::mutex g_outputMutex;
std::atomic<bool> g_running{true};
UINT_PTR g_refreshTimer = 0;
HWND g_appBarHwnd = nullptr;

std::string toUtf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                                         static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (length <= 0) return {};
  std::string result(static_cast<size_t>(length), '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                      static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
  return result;
}

std::string escapeJson(const std::string& value) {
  std::string result;
  result.reserve(value.size() + 16);
  constexpr char hex[] = "0123456789abcdef";
  for (const unsigned char ch : value) {
    switch (ch) {
      case '\"': result += "\\\""; break;
      case '\\': result += "\\\\"; break;
      case '\b': result += "\\b"; break;
      case '\f': result += "\\f"; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default:
        if (ch < 0x20) {
          result += "\\u00";
          result += hex[(ch >> 4) & 0x0f];
          result += hex[ch & 0x0f];
        } else {
          result += static_cast<char>(ch);
        }
    }
  }
  return result;
}

std::wstring getWindowText(HWND hwnd) {
  const int length = GetWindowTextLengthW(hwnd);
  if (length <= 0) return {};
  std::wstring title(static_cast<size_t>(length) + 1, L'\0');
  const int copied = GetWindowTextW(hwnd, title.data(), length + 1);
  if (copied <= 0) return {};
  title.resize(static_cast<size_t>(copied));
  return title;
}

bool isCloaked(HWND hwnd) {
  DWORD cloaked = 0;
  return SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked != 0;
}

bool isEligibleWindow(HWND hwnd) {
  if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || GetAncestor(hwnd, GA_ROOT) != hwnd) return false;
  const LONG_PTR exStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if ((exStyle & WS_EX_TOOLWINDOW) != 0 || isCloaked(hwnd)) return false;
  if (GetWindow(hwnd, GW_OWNER) != nullptr && (exStyle & WS_EX_APPWINDOW) == 0) return false;

  wchar_t className[128]{};
  GetClassNameW(hwnd, className, static_cast<int>(std::size(className)));
  const std::wstring_view windowClass(className);
  if (windowClass == L"Progman" || windowClass == L"WorkerW" ||
      windowClass == L"Shell_TrayWnd" || windowClass == L"Shell_SecondaryTrayWnd") return false;

  return !getWindowText(hwnd).empty();
}

void readProcessInfo(DWORD processId, std::wstring& name, std::wstring& path) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (process == nullptr) return;
  std::vector<wchar_t> buffer(32768);
  DWORD size = static_cast<DWORD>(buffer.size());
  if (QueryFullProcessImageNameW(process, 0, buffer.data(), &size)) {
    path.assign(buffer.data(), size);
    const size_t slash = path.find_last_of(L"\\/");
    name = slash == std::wstring::npos ? path : path.substr(slash + 1);
    const size_t dot = name.find_last_of(L'.');
    if (dot != std::wstring::npos) name.resize(dot);
  }
  CloseHandle(process);
}

BOOL CALLBACK enumerateCallback(HWND hwnd, LPARAM parameter) {
  if (!isEligibleWindow(hwnd)) return TRUE;
  auto& windows = *reinterpret_cast<std::vector<WindowInfo>*>(parameter);
  WindowInfo info;
  info.hwnd = hwnd;
  info.title = getWindowText(hwnd);
  GetWindowThreadProcessId(hwnd, &info.processId);
  readProcessInfo(info.processId, info.processName, info.executablePath);
  if (info.processName.empty()) info.processName = L"Unknown";
  info.minimized = IsIconic(hwnd) != FALSE;
  windows.push_back(std::move(info));
  return TRUE;
}

std::vector<WindowInfo> listWindows() {
  std::vector<WindowInfo> windows;
  EnumWindows(enumerateCallback, reinterpret_cast<LPARAM>(&windows));
  return windows;
}

std::string hwndString(HWND hwnd) {
  return std::to_string(reinterpret_cast<uintptr_t>(hwnd));
}

void writeLine(const std::string& value) {
  std::lock_guard lock(g_outputMutex);
  std::cout << value << '\n' << std::flush;
}

void emitSnapshot(const std::string& requestId = {}) {
  const auto windows = listWindows();
  const HWND foreground = GetForegroundWindow();
  std::ostringstream json;
  json << "{\"type\":\"snapshot\"";
  if (!requestId.empty()) json << ",\"requestId\":\"" << escapeJson(requestId) << "\"";
  json << ",\"activeHwnd\":";
  if (foreground != nullptr) json << "\"" << hwndString(foreground) << "\"";
  else json << "null";
  json << ",\"windows\":[";
  bool first = true;
  for (const auto& window : windows) {
    if (!first) json << ',';
    first = false;
    json << "{\"hwnd\":\"" << hwndString(window.hwnd)
         << "\",\"title\":\"" << escapeJson(toUtf8(window.title))
         << "\",\"processId\":" << window.processId
         << ",\"processName\":\"" << escapeJson(toUtf8(window.processName))
         << "\",\"executablePath\":\"" << escapeJson(toUtf8(window.executablePath))
         << "\",\"minimized\":" << (window.minimized ? "true" : "false") << '}';
  }
  json << "]}";
  writeLine(json.str());
}

bool parseHwnd(const std::string& value, HWND& hwnd) {
  uintptr_t raw = 0;
  const auto [end, error] = std::from_chars(value.data(), value.data() + value.size(), raw);
  if (error != std::errc{} || end != value.data() + value.size()) return false;
  hwnd = reinterpret_cast<HWND>(raw);
  return IsWindow(hwnd) != FALSE;
}

bool activateWindow(HWND hwnd) {
  if (!IsWindow(hwnd)) return false;
  if (IsIconic(hwnd)) ShowWindowAsync(hwnd, SW_RESTORE);
  // SetForegroundWindow intentionally respects Windows' foreground-lock policy.
  return SetForegroundWindow(hwnd) != FALSE;
}

void removeAppBar() {
  if (g_appBarHwnd == nullptr) return;
  APPBARDATA data{};
  data.cbSize = sizeof(data);
  data.hWnd = g_appBarHwnd;
  SHAppBarMessage(ABM_REMOVE, &data);
  g_appBarHwnd = nullptr;
}

bool setAppBar(const std::string& argument) {
  std::istringstream input(argument);
  std::string part;
  std::vector<std::string> values;
  while (std::getline(input, part, ',')) values.push_back(part);
  if (values.size() != 5) return false;

  HWND hwnd = nullptr;
  if (!parseHwnd(values[0], hwnd)) return false;

  long coordinates[4]{};
  for (size_t index = 0; index < 4; ++index) {
    const auto [end, error] = std::from_chars(
        values[index + 1].data(), values[index + 1].data() + values[index + 1].size(), coordinates[index]);
    if (error != std::errc{} || end != values[index + 1].data() + values[index + 1].size()) return false;
  }

  if (g_appBarHwnd != hwnd) {
    removeAppBar();
    APPBARDATA registration{};
    registration.cbSize = sizeof(registration);
    registration.hWnd = hwnd;
    registration.uCallbackMessage = RegisterWindowMessageW(L"FlowDock.AppBarMessage");
    if (SHAppBarMessage(ABM_NEW, &registration) == 0) return false;
    g_appBarHwnd = hwnd;
  }

  APPBARDATA position{};
  position.cbSize = sizeof(position);
  position.hWnd = hwnd;
  position.uEdge = ABE_RIGHT;
  position.rc = {coordinates[0], coordinates[1], coordinates[2], coordinates[3]};
  const LONG width = position.rc.right - position.rc.left;
  SHAppBarMessage(ABM_QUERYPOS, &position);
  position.rc.left = position.rc.right - width;
  return SHAppBarMessage(ABM_SETPOS, &position) != 0;
}

void emitResult(const Command& command, bool ok) {
  writeLine("{\"type\":\"result\",\"requestId\":\"" + escapeJson(command.requestId) +
            "\",\"ok\":" + (ok ? "true" : "false") + "}");
}

void processCommand(Command* rawCommand) {
  std::unique_ptr<Command> command(rawCommand);
  if (command->verb == "LIST") {
    emitSnapshot(command->requestId);
    return;
  }
  if (command->verb == "ACTIVATE" || command->verb == "RESTORE") {
    HWND hwnd = nullptr;
    bool ok = parseHwnd(command->argument, hwnd);
    if (ok) {
      if (command->verb == "RESTORE") {
        ok = ShowWindowAsync(hwnd, SW_RESTORE) != FALSE;
      } else {
        ok = activateWindow(hwnd);
      }
    }
    emitResult(*command, ok);
    return;
  }
  if (command->verb == "APPBAR") {
    emitResult(*command, setAppBar(command->argument));
    return;
  }
  if (command->verb == "UNAPPBAR") {
    removeAppBar();
    emitResult(*command, true);
    return;
  }
  if (command->verb == "QUIT") {
    removeAppBar();
    emitResult(*command, true);
    g_running = false;
    PostQuitMessage(0);
    return;
  }
  emitResult(*command, false);
}

void inputLoop() {
  std::string line;
  while (g_running && std::getline(std::cin, line)) {
    std::istringstream input(line);
    auto* command = new Command();
    input >> command->verb >> command->requestId >> command->argument;
    if (command->verb.empty() || command->requestId.empty() ||
        !PostThreadMessageW(g_mainThreadId, kCommandMessage, 0, reinterpret_cast<LPARAM>(command))) {
      delete command;
    }
  }
  if (g_running) PostThreadMessageW(g_mainThreadId, WM_QUIT, 0, 0);
}

void CALLBACK eventCallback(HWINEVENTHOOK, DWORD, HWND hwnd, LONG objectId, LONG childId,
                            DWORD, DWORD) {
  if (hwnd == nullptr) return;
  if (objectId != OBJID_WINDOW && objectId != OBJID_CLIENT) return;
  if (childId != CHILDID_SELF && childId != 0) return;
  PostThreadMessageW(g_mainThreadId, kRefreshMessage, 0, 0);
}
}  // namespace

int main(int argc, char* argv[]) {
  SetConsoleOutputCP(CP_UTF8);

  // A process created directly by the foreground process is eligible to request
  // foreground activation under Windows' normal focus policy. Electron uses this
  // one-shot mode only in direct response to a user click or Enter key press.
  if (argc == 3 && std::string_view(argv[1]) == "--activate") {
    HWND hwnd = nullptr;
    if (!parseHwnd(argv[2], hwnd)) return 2;
    return activateWindow(hwnd) ? 0 : 3;
  }

  g_mainThreadId = GetCurrentThreadId();
  MSG bootstrap{};
  PeekMessageW(&bootstrap, nullptr, WM_USER, WM_USER, PM_NOREMOVE);

  constexpr DWORD flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
  const std::vector<HWINEVENTHOOK> hooks = {
      SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, eventCallback, 0, 0, flags),
      SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, nullptr, eventCallback, 0, 0, flags),
      SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, nullptr, eventCallback, 0, 0, flags),
      SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, nullptr, eventCallback, 0, 0, flags)};
  if (std::ranges::any_of(hooks, [](HWINEVENTHOOK hook) { return hook == nullptr; })) {
    for (const HWINEVENTHOOK hook : hooks) if (hook != nullptr) UnhookWinEvent(hook);
    writeLine("{\"type\":\"error\",\"message\":\"SetWinEventHook failed\"}");
    return 1;
  }

  std::thread inputThread(inputLoop);
  emitSnapshot();

  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (message.message == kCommandMessage) {
      processCommand(reinterpret_cast<Command*>(message.lParam));
    } else if (message.message == kRefreshMessage) {
      if (g_refreshTimer != 0) KillTimer(nullptr, g_refreshTimer);
      g_refreshTimer = SetTimer(nullptr, 0, kRefreshDelayMs, nullptr);
    } else if (message.message == WM_TIMER && message.wParam == g_refreshTimer) {
      KillTimer(nullptr, g_refreshTimer);
      g_refreshTimer = 0;
      emitSnapshot();
    }
  }

  g_running = false;
  removeAppBar();
  if (g_refreshTimer != 0) KillTimer(nullptr, g_refreshTimer);
  for (const HWINEVENTHOOK hook : hooks) UnhookWinEvent(hook);
  if (inputThread.joinable()) inputThread.detach();
  return 0;
}
