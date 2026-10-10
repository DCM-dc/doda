#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs::OpenOptions, io::{Read, Write}, net::{TcpListener, TcpStream}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(unix)]
use std::os::unix::process::CommandExt;

struct Backend(Mutex<Option<Child>>);

fn packaged_root(executable: &Path, platform: &str, arch: &str) -> Option<PathBuf> {
    let base = executable.parent()?;
    let resources = if platform == "macos" { base.parent()?.join("Resources") } else { base.to_path_buf() };
    let system = if platform == "macos" { "darwin" } else if platform == "windows" { "win32" } else { return None };
    let arch = if arch == "aarch64" { "arm64" } else if arch == "x86_64" { "x64" } else { return None };
    let root = resources.join(format!("runtime/{system}-{arch}/backend"));
    root.join("server/index.ts").is_file().then_some(root)
}

fn app_root() -> Result<(PathBuf, bool), String> {
    if let Some(root) = std::env::var_os("DODA_ROOT") { return Ok((root.into(), false)); }
    let executable = std::env::current_exe().map_err(|_| "EXECUTABLE_PATH_FAILED")?;
    if let Some(root) = packaged_root(&executable, std::env::consts::OS, std::env::consts::ARCH) { return Ok((root, true)); }
    if let Some(parent) = executable.parent() {
        if parent.join("server/index.ts").is_file() { return Ok((parent.into(), false)); }
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    if root.join("server/index.ts").is_file() { Ok((root, false)) } else { Err("APP_RESOURCES_MISSING".into()) }
}

fn default_data(platform: &str, local: Option<PathBuf>, home: Option<PathBuf>) -> Result<PathBuf, String> {
    match platform {
        "windows" => local.map(|base| base.join("doda")).ok_or_else(|| "LOCALAPPDATA_MISSING".into()),
        "macos" => home.map(|base| base.join("Library/Application Support/local.doda.desktop")).ok_or_else(|| "HOME_MISSING".into()),
        _ => Err("UNSUPPORTED_PLATFORM".into()),
    }
}

fn start_backend(root: &Path, data: &Path, packaged: bool, port: u16) -> Result<Child, String> {
    std::fs::create_dir_all(data).map_err(|e| format!("DATA_DIRECTORY_FAILED: {e}"))?;
    let log = OpenOptions::new().create(true).append(true).open(data.join("desktop.log")).map_err(|e| format!("LOG_OPEN_FAILED: {e}"))?;
    let runtime = root.parent().ok_or("RUNTIME_DIRECTORY_MISSING")?;
    let node = std::env::var_os("DODA_NODE").map(PathBuf::from).unwrap_or_else(|| if packaged { runtime.join(if cfg!(windows) { "bin/node.exe" } else { "bin/node" }) } else { PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" }) });
    let mut command = Command::new(&node);
    command.current_dir(root).args(["--import", "tsx", "server/index.ts"])
        .env("DODA_DATA", data).env("DODA_PORT", port.to_string()).env("DODA_PRODUCTION", "1")
        .stdin(Stdio::null()).stdout(log.try_clone().map_err(|_| "LOG_CLONE_FAILED")?).stderr(log);
    if packaged {
        let resources = runtime.parent().and_then(Path::parent).ok_or("RESOURCE_DIRECTORY_MISSING")?;
        command.env("PLAYWRIGHT_BROWSERS_PATH", runtime.join("browsers"));
        command.env("DODA_ASR_MODEL", resources.join("asr/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"));
        let mut paths = vec![runtime.join("bin")];
        if let Some(path) = std::env::var_os("PATH") { paths.extend(std::env::split_paths(&path)); }
        command.env("PATH", std::env::join_paths(paths).map_err(|_| "NODE_PATH_FAILED")?);
        #[cfg(target_os = "macos")]
        command.env("DODA_CREDENTIAL_HELPER", resources.join("helpers/doda-keychain"));
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    command.process_group(0);
    command.spawn().map_err(|e| format!("BACKEND_START_FAILED: {e}"))
}

fn ready(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_millis(150)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.write_all(format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").as_bytes());
    let mut response = String::new(); let _ = stream.read_to_string(&mut response);
    response.contains("200 OK") && response.contains("\"ok\":true")
}

fn stop_backend(child: &mut Child) {
    #[cfg(windows)]
    { let mut command = Command::new("taskkill.exe"); command.args(["/PID", &child.id().to_string(), "/T", "/F"]).creation_flags(0x08000000).stdout(Stdio::null()).stderr(Stdio::null()); let _ = command.status(); }
    #[cfg(unix)]
    unsafe {
        extern "C" { fn kill(pid: i32, signal: i32) -> i32; }
        kill(-(child.id() as i32), 15);
        let started = Instant::now();
        while child.try_wait().ok().flatten().is_none() && started.elapsed() < Duration::from_secs(3) { std::thread::sleep(Duration::from_millis(25)); }
        kill(-(child.id() as i32), 9);
    }
    let _ = child.kill(); let _ = child.wait();
}

fn main() {
    let smoke = std::env::args().any(|arg| arg == "--smoke-test");
    if smoke && std::env::var_os("DODA_DATA").is_none() { panic!("SMOKE_TEST_REQUIRES_ISOLATED_DATA"); }
    let (root, packaged) = app_root().expect("APP_ROOT_FAILED");
    let data = std::env::var_os("DODA_DATA").map(PathBuf::from).unwrap_or_else(|| if packaged { default_data(std::env::consts::OS, std::env::var_os("LOCALAPPDATA").map(PathBuf::from), std::env::var_os("HOME").map(PathBuf::from)).expect("APP_DATA_FAILED") } else { root.join(".data") });
    let port = (4318..4418).find(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok()).expect("NO_AVAILABLE_LOCAL_PORT");
    let mut child = start_backend(&root, &data, packaged, port).expect("BACKEND_START_FAILED");
    let mut started = false;
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if ready(port) { started = true; break; }
        if child.try_wait().ok().flatten().is_some() { break; }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !started { stop_backend(&mut child); panic!("BACKEND_NOT_READY: see {}", data.join("desktop.log").display()); }
    if smoke {
        println!("{{\"ok\":true,\"port\":{port},\"packaged\":{packaged}}}");
        let _ = std::io::stdout().flush();
        let _ = std::io::stdin().read_to_end(&mut Vec::new());
        stop_backend(&mut child);
        return;
    }
    tauri::Builder::default().manage(Backend(Mutex::new(Some(child)))).setup(move |app| {
        WebviewWindowBuilder::new(app, "main", WebviewUrl::External(format!("http://127.0.0.1:{port}").parse()?))
            .title("doda · 把想法做出来").inner_size(1360.0, 900.0).min_inner_size(760.0, 620.0).build()?;
        Ok(())
    }).build(tauri::generate_context!()).expect("DESKTOP_BUILD_FAILED").run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Backend>().0.lock().unwrap().take() { stop_backend(&mut child); }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_architecture_resolves_only_the_matching_backend() {
        let base = std::env::temp_dir().join(format!("doda-layout-{}", std::process::id()));
        for (platform, arch, executable, backend) in [
            ("windows", "x86_64", "win/doda-desktop.exe", "win/runtime/win32-x64/backend"),
            ("macos", "aarch64", "doda.app/Contents/MacOS/doda-desktop", "doda.app/Contents/Resources/runtime/darwin-arm64/backend"),
            ("macos", "x86_64", "doda.app/Contents/MacOS/doda-desktop", "doda.app/Contents/Resources/runtime/darwin-x64/backend"),
        ] {
            let root = base.join(backend);
            std::fs::create_dir_all(root.join("server")).unwrap();
            std::fs::write(root.join("server/index.ts"), "").unwrap();
            assert_eq!(packaged_root(&base.join(executable), platform, arch), Some(root));
        }
        assert_eq!(packaged_root(&base.join("missing/doda.exe"), "windows", "x86_64"), None);
        assert_eq!(packaged_root(&base.join("win/doda.exe"), "windows", "unsupported"), None);
        assert_eq!(packaged_root(&base.join("win/doda.exe"), "linux", "x86_64"), None);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn installed_data_lives_outside_read_only_app_resources() {
        assert_eq!(default_data("windows", Some(PathBuf::from("local")), None).unwrap(), PathBuf::from("local/doda"));
        assert_eq!(default_data("macos", None, Some(PathBuf::from("home"))).unwrap(), PathBuf::from("home/Library/Application Support/local.doda.desktop"));
        assert_eq!(default_data("windows", None, None), Err("LOCALAPPDATA_MISSING".into()));
        assert_eq!(default_data("macos", None, None), Err("HOME_MISSING".into()));
    }
}
