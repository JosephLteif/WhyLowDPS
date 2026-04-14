use single_instance::SingleInstance;
use std::fs;
use std::io::Cursor;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tokio::time::sleep;

#[tokio::main]
async fn main() {
    let instance = SingleInstance::new("whylowdps-launcher").unwrap();
    if !instance.is_single() {
        let _ = webbrowser::open("http://localhost:8000");
        return;
    }

    println!("-------------------------------------------");
    println!("   WhyLowDps Desktop Launcher             ");
    println!("-------------------------------------------");

    // 1. Check for SimulationCraft
    let simc_dir = Path::new("resources/simc");
    let simc_bin = if cfg!(windows) {
        simc_dir.join("simc.exe")
    } else {
        simc_dir.join("simc")
    };

    // Disabled: SimC is now downloaded on demand via the web UI / backend updater.
    /*
    if !simc_bin.exists() {
        println!("(!) SimulationCraft not found. Bootstrapping...");
        if let Err(e) = bootstrap_simc(simc_dir).await {
            eprintln!(
                "Error Downloading SimC: {}. You may need to install it manually in resources/simc",
                e
            );
        } else {
            println!("(+) SimulationCraft installed successfully.");
        }
    }
    */

    // 2. Start WhyLowDps Server
    println!("Starting Simulation Server...");
    let server_bin = if cfg!(windows) {
        "whylowdps-server.exe"
    } else {
        "./whylowdps-server"
    };

    // Check if server exists in current dir
    if !Path::new(server_bin).exists() {
        eprintln!("Error: {} not found in the current directory.", server_bin);
        // In dev mode, we might be running from cargo, but for the 'app', it should be there.
    }

    let mut server_child = Command::new(server_bin)
        .env("PORT", "8000")
        .env("DATABASE_URL", "whylowdps.db")
        .env("SIMC_PATH", simc_bin.to_str().unwrap_or("simc"))
        .spawn()
        .expect("Failed to start WhyLowDps server.");

    // 3. Wait for server to be ready
    let client = reqwest::Client::new();
    let mut attempts = 0;
    while attempts < 30 {
        if let Ok(resp) = client.get("http://localhost:8000/health").send().await {
            if resp.status().is_success() {
                break;
            }
        }
        sleep(Duration::from_secs(1)).await;
        attempts += 1;
    }

    // 4. Open Browser
    println!("Opening WhyLowDps in your browser...");
    if let Err(e) = webbrowser::open("http://localhost:8000") {
        eprintln!(
            "Failed to open browser: {}. Please visit http://localhost:8000 manually.",
            e
        );
    }

    println!("App is running. Use the Settings menu in the web UI to shut down.");

    // Keep launcher alive to monitor server?
    // If the server process dies, the launcher should probably exit.
    loop {
        match server_child.try_wait() {
            Ok(Some(status)) => {
                println!("Server exited with status: {}", status);
                break;
            }
            Ok(None) => {
                sleep(Duration::from_secs(2)).await;
            }
            Err(e) => {
                eprintln!("Error monitoring server: {}", e);
                break;
            }
        }
    }
}

/*
async fn bootstrap_simc(dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
...
    Ok(())
}
*/
