use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tokio::time::sleep;
use single_instance::SingleInstance;
use std::fs;
use std::io::Cursor;

#[tokio::main]
async fn main() {
    let instance = SingleInstance::new("simhammer-launcher").unwrap();
    if !instance.is_single() {
        let _ = webbrowser::open("http://localhost:8000");
        return;
    }

    println!("-------------------------------------------");
    println!("   SimHammer Desktop Launcher             ");
    println!("-------------------------------------------");

    // 1. Check for SimulationCraft
    let simc_dir = Path::new("resources/simc");
    let simc_bin = if cfg!(windows) {
        simc_dir.join("simc.exe")
    } else {
        simc_dir.join("simc")
    };

    if !simc_bin.exists() {
        println!("(!) SimulationCraft not found. Bootstrapping...");
        if let Err(e) = bootstrap_simc(simc_dir).await {
            eprintln!("Error Downloading SimC: {}. You may need to install it manually in resources/simc", e);
        } else {
            println!("(+) SimulationCraft installed successfully.");
        }
    }

    // 2. Start SimHammer Server
    println!("Starting Simulation Server...");
    let server_bin = if cfg!(windows) { "simhammer-server.exe" } else { "./simhammer-server" };
    
    // Check if server exists in current dir
    if !Path::new(server_bin).exists() {
         eprintln!("Error: {} not found in the current directory.", server_bin);
         // In dev mode, we might be running from cargo, but for the 'app', it should be there.
    }

    let mut server_child = Command::new(server_bin)
        .env("PORT", "8000")
        .env("DATABASE_URL", "simhammer.db")
        .env("SIMC_PATH", simc_bin.to_str().unwrap_or("simc"))
        .spawn()
        .expect("Failed to start SimHammer server.");

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
    println!("Opening SimHammer in your browser...");
    if let Err(e) = webbrowser::open("http://localhost:8000") {
        eprintln!("Failed to open browser: {}. Please visit http://localhost:8000 manually.", e);
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

async fn bootstrap_simc(dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(dir)?;
    
    let url = if cfg!(windows) {
        "https://github.com/simulationcraft/simc/releases/download/v1100-01/simc-1100-01-win64.zip"
    } else {
        // Fallback or Linux URL if needed
        return Err("Automatic download only supported for Windows currently. Please install SimC in resources/simc manually.".into());
    };

    println!("Downloading from GitHub...");
    let response = reqwest::get(url).await?;
    let content = response.bytes().await?;
    
    println!("Extracting...");
    let mut archive = zip::ZipArchive::new(Cursor::new(content))?;
    
    // Extract everything to the dir
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let outpath = dir.join(file.name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                fs::create_dir_all(p)?;
            }
            let mut outfile = fs::File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    }

    Ok(())
}
