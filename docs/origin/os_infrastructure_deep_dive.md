> **Superseded, kept for origin.** This is the original vision document, written before the
> architecture was settled. Two of its claims are no longer how we describe the system:
>
> 1. It argues that Doen Thang **is** an operating system. It is not. It is a *service layer*
>    over Solari's infrastructure. "OS" survives as product-facing language only. See
>    `docs/PLAN.md` section 1.5 and ADR-0011.
> 2. It treats travel as the substrate. It isn't. The substrate is **Samsara**, a
>    domain-agnostic situated-observation layer; travel is vertical one. See `docs/PLAN.md`
>    section 1.6 and ADR-0009.
>
> Read it for the product feeling and the flywheel argument, which still hold. Do not read it
> for architecture. `docs/PLAN.md` is the only normative document.

---

# Doen Thang: The OS Layer Deep Dive

To understand how Doen Thang is technically an **Operating System** and not just a web app, we have to look at how a traditional OS (like Windows or macOS) is built and map it to the underlying infrastructure.

A traditional OS has a **Kernel** (to manage hardware), a **Scheduler** (to run background processes), a **File System** (to save state), and an **Execution Environment** (to run apps safely). 

Here is exactly how Doen Thang replicates that architecture using Solari's infrastructure:

### 1. The Kernel (Solari MicroVMs)
In a normal app, your code runs on a single server (like an AWS EC2 instance). If you want to scrape a site, that single server makes the request. 
In Doen Thang, the "Hardware" is a fleet of distributed, hardware-isolated microVMs provided by Solari. 
* **How it works:** Your central Node.js server acts as the **Kernel**. It doesn't do the heavy lifting itself; it simply dispatches commands to Solari’s API. Just like an OS Kernel tells the CPU what to do, your server tells Solari to spin up, freeze, or destroy virtual machines across the globe in milliseconds.

### 2. Process Management (The Arbitrage Daemons)
An OS runs background services (daemons) that operate independently of the user interface. "Hundred Eyes" is your process manager.
* **How it works:** When a user says "Watch this flight to Tokyo," they are spawning a background process. Your Node.js backend pushes a job to a queue (like Redis or BullMQ). A worker picks it up and concurrently launches 20 Solari browser instances:
  ```typescript
  // The OS spawning parallel processes across global hardware
  const proxies = ["us", "th", "br", "jp"];
  const processes = proxies.map(region => 
    solari.launch({ stealth: true, proxy: region })
  );
  ```
  These browsers act like individual threads. They execute their task, report the price data back to the central server, and then terminate, freeing up memory.

### 3. The File System (The Profile Vault)
A normal app saves text to a database (like PostgreSQL). An OS saves *entire states* (memory, caches, session tokens). 
* **How it works:** To pull off "Algorithmic Spying," you aren't just saving scraped videos to a database. You are saving the literal "brain" of the browser. 
  ```typescript
  // Saving the literal state of the machine to the OS File System
  const state = await page.context().storageState();
  await solari.profiles.save("kyoto-local-profile-id", state);
  ```
  This is your OS's file system. Doen Thang maintains a vault of hundreds of these Solari Profiles. When you need to see what the Kyoto algorithm is showing today, your OS "loads" that specific profile state back into a new microVM. 

### 4. The Execution Environment (Sandboxed Apps)
An OS must provide a safe place for applications to run without crashing the whole system. In Doen Thang, your **Postcards** are the applications.
* **How it works:** A Postcard in the UI is just the frontend representation of an executable script. If a user clicks "Book Train" on a Postcard, it sends an IPC (Inter-Process Communication) request to your backend. 
* Your backend then uses Solari’s **Sandbox** product (which boots headless Linux VMs in a few milliseconds from a memory snapshot):
  ```typescript
  import { SandboxClient } from "@solarisdk/sandbox";
  
  // The OS launching a secure sandbox to execute an app (the booking agent)
  const sbx = await sandboxes.create({ template: "agent-runner" });
  const result = await sbx.commands.run("python3", { args: ["book_ticket.py", "--dest=BKK"] });
  ```
  The Python agent runs inside this disposable Sandbox. It navigates the foreign website, executes the booking, and passes the receipt back to the main OS. If the script fails or encounters malware on the foreign site, you just run `sbx.kill()`. The main system is completely protected.

### Summary of the Stack
When a user logs into Doen Thang, they are looking at a UI (the Desktop Environment). Behind the scenes, they are actually commanding a fleet of disposable, global Linux microVMs, constantly shifting proxies, swapping digital profiles, and executing sandboxed AI agents. 

That is why it is an OS. It is a system that orchestrates physical and virtual compute on a global scale to execute the user's travel intent.
