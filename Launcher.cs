using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;
using System.Threading;
using System.Reflection;
using System.Collections.Generic;
using System.Text;
using System.Windows.Forms;

namespace TaiwanPortsSpillSim
{
    static class Program
    {
        private static volatile bool s_running = true;
        private static volatile bool s_hasConnected = false;
        private static volatile bool s_exitRequested = false;
        private static long s_lastActivityTicks = DateTime.UtcNow.Ticks;

        private static readonly Dictionary<string, string> s_resourceMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "index.html", "app_index.html" },
            { "style.css", "app_style.css" },
            { "app.js", "app_app.js" },
            { "taiwan-geojson.js", "app_taiwan_geojson.js" },
            { "taiwan.geojson", "app_taiwan.geojson" },
            { "tide-data.js", "app_tide_data.js" },
            { "lib/leaflet.css", "app_lib_leaflet.css" },
            { "lib/leaflet.js", "app_lib_leaflet.js" },
            { "app.ico", "app_app.ico" },
            { "favicon.ico", "app_app.ico" }
        };

        [STAThread]
        static void Main(string[] args)
        {
            bool isHeadlessTest = (args != null && args.Length > 0 && args[0].Equals("--headless-test", StringComparison.OrdinalIgnoreCase));

            bool createdNew;
            using (Mutex mutex = new Mutex(true, "TaiwanPortsSpillSim_App_Mutex_v1", out createdNew))
            {
                if (!createdNew && !isHeadlessTest)
                {
                    MessageBox.Show(
                        "台灣沿海船難海污模擬系統 已在運行中。\n請直接在工作列切換至系統視窗！",
                        "台灣沿海船難海污模擬系統",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                    return;
                }

                int port;
                HttpListener listener = CreateAndStartListener(out port);
                if (listener == null)
                {
                    if (!isHeadlessTest)
                    {
                        MessageBox.Show(
                            "本機伺服器無法啟動，請檢查連接埠或系統權限。",
                            "啟動失敗",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error);
                    }
                    return;
                }

                string portFile = Path.Combine(Path.GetTempPath(), "TaiwanSpillSim_Port.txt");
                try { File.WriteAllText(portFile, port.ToString()); } catch { }

                Thread serverThread = new Thread(new ParameterizedThreadStart(RunServer));
                serverThread.IsBackground = true;
                serverThread.Start(listener);

                string targetUrl = string.Format("http://127.0.0.1:{0}/index.html", port);

                if (!isHeadlessTest)
                {
                    string browserPath = FindBrowser();
                    try
                    {
                        if (!string.IsNullOrEmpty(browserPath))
                        {
                            ProcessStartInfo psi = new ProcessStartInfo();
                            psi.FileName = browserPath;
                            psi.Arguments = string.Format("--app=\"{0}\"", targetUrl);
                            psi.UseShellExecute = false;
                            Process.Start(psi);
                        }
                        else
                        {
                            Process.Start(targetUrl);
                        }
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show(
                            "無法啟動系統應用視窗: " + ex.Message,
                            "錯誤",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error);
                    }
                }

                // Keep-Alive Watchdog Loop
                int startupTimeoutSec = isHeadlessTest ? 10 : 45;
                DateTime startTime = DateTime.UtcNow;

                while (s_running)
                {
                    Thread.Sleep(500);

                    if (s_exitRequested)
                    {
                        break;
                    }

                    if (!s_hasConnected)
                    {
                        if ((DateTime.UtcNow - startTime).TotalSeconds > startupTimeoutSec)
                        {
                            break;
                        }
                    }
                    else
                    {
                        long lastTicks = Interlocked.Read(ref s_lastActivityTicks);
                        TimeSpan idleTime = DateTime.UtcNow - new DateTime(lastTicks);
                        if (idleTime.TotalSeconds > 8.0)
                        {
                            // Browser window closed
                            break;
                        }
                    }
                }

                s_running = false;
                try { if (File.Exists(portFile)) File.Delete(portFile); } catch { }

                try
                {
                    if (listener != null && listener.IsListening)
                    {
                        listener.Stop();
                        listener.Close();
                    }
                }
                catch { }
            }
        }

        private static HttpListener CreateAndStartListener(out int actualPort)
        {
            int[] preferredPorts = new int[] { 8089, 8088, 8090, 8091, 8092, 8080 };
            foreach (int p in preferredPorts)
            {
                try
                {
                    HttpListener l = new HttpListener();
                    l.Prefixes.Add(string.Format("http://127.0.0.1:{0}/", p));
                    l.Prefixes.Add(string.Format("http://localhost:{0}/", p));
                    l.Start();
                    actualPort = p;
                    return l;
                }
                catch { }
            }

            try
            {
                TcpListener tl = new TcpListener(IPAddress.Loopback, 0);
                tl.Start();
                int freePort = ((IPEndPoint)tl.LocalEndpoint).Port;
                tl.Stop();

                HttpListener l = new HttpListener();
                l.Prefixes.Add(string.Format("http://127.0.0.1:{0}/", freePort));
                l.Prefixes.Add(string.Format("http://localhost:{0}/", freePort));
                l.Start();
                actualPort = freePort;
                return l;
            }
            catch
            {
                actualPort = 0;
                return null;
            }
        }

        private static void RunServer(object state)
        {
            HttpListener listener = (HttpListener)state;
            while (s_running)
            {
                try
                {
                    HttpListenerContext ctx = listener.GetContext();
                    ThreadPool.QueueUserWorkItem(new WaitCallback(ProcessRequest), ctx);
                }
                catch (HttpListenerException) { break; }
                catch (ObjectDisposedException) { break; }
                catch (Exception) { }
            }
        }

        private static void ProcessRequest(object state)
        {
            HttpListenerContext ctx = (HttpListenerContext)state;
            HttpListenerRequest req = ctx.Request;
            HttpListenerResponse resp = ctx.Response;

            try
            {
                s_hasConnected = true;
                Interlocked.Exchange(ref s_lastActivityTicks, DateTime.UtcNow.Ticks);

                string path = req.Url.AbsolutePath.TrimStart('/');
                if (string.IsNullOrEmpty(path))
                {
                    path = "index.html";
                }

                path = Uri.UnescapeDataString(path);

                if (path.Equals("api/heartbeat", StringComparison.OrdinalIgnoreCase))
                {
                    resp.StatusCode = 200;
                    byte[] ok = Encoding.UTF8.GetBytes("{\"alive\":true}");
                    resp.ContentType = "application/json; charset=utf-8";
                    resp.ContentLength64 = ok.Length;
                    resp.OutputStream.Write(ok, 0, ok.Length);
                    resp.Close();
                    return;
                }

                if (path.Equals("api/exit", StringComparison.OrdinalIgnoreCase))
                {
                    resp.StatusCode = 200;
                    byte[] ok = Encoding.UTF8.GetBytes("{\"ok\":true}");
                    resp.ContentType = "application/json; charset=utf-8";
                    resp.ContentLength64 = ok.Length;
                    resp.OutputStream.Write(ok, 0, ok.Length);
                    resp.Close();
                    s_exitRequested = true;
                    return;
                }

                byte[] data = null;

                // Priority 1: ALWAYS load internal embedded assets for the system
                string resName;
                if (s_resourceMap.TryGetValue(path, out resName))
                {
                    data = LoadEmbeddedResource(resName);
                }

                // Priority 2: Fallback to local files only if not found in embedded resources
                if (data == null)
                {
                    string localPath = Path.Combine(
                        AppDomain.CurrentDomain.BaseDirectory,
                        path.Replace('/', Path.DirectorySeparatorChar)
                    );

                    if (File.Exists(localPath))
                    {
                        data = File.ReadAllBytes(localPath);
                    }
                }

                if (data == null)
                {
                    resp.StatusCode = 404;
                    byte[] notFound = Encoding.UTF8.GetBytes("404 Not Found");
                    resp.ContentType = "text/plain; charset=utf-8";
                    resp.ContentLength64 = notFound.Length;
                    resp.OutputStream.Write(notFound, 0, notFound.Length);
                }
                else
                {
                    resp.StatusCode = 200;
                    resp.ContentType = GetContentType(path);
                    resp.ContentLength64 = data.Length;
                    resp.Headers.Add("Access-Control-Allow-Origin", "*");
                    resp.OutputStream.Write(data, 0, data.Length);
                }
            }
            catch (Exception)
            {
                try { resp.StatusCode = 500; } catch { }
            }
            finally
            {
                try { resp.Close(); } catch { }
            }
        }

        private static byte[] LoadEmbeddedResource(string resourceName)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream s = asm.GetManifestResourceStream(resourceName))
            {
                if (s == null) return null;
                byte[] buffer = new byte[s.Length];
                int totalRead = 0;
                while (totalRead < buffer.Length)
                {
                    int read = s.Read(buffer, totalRead, buffer.Length - totalRead);
                    if (read == 0) break;
                    totalRead += read;
                }
                return buffer;
            }
        }

        private static string GetContentType(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            switch (ext)
            {
                case ".html":
                case ".htm":
                    return "text/html; charset=utf-8";
                case ".css":
                    return "text/css; charset=utf-8";
                case ".js":
                    return "application/javascript; charset=utf-8";
                case ".json":
                case ".geojson":
                    return "application/json; charset=utf-8";
                case ".png":
                    return "image/png";
                case ".jpg":
                case ".jpeg":
                    return "image/jpeg";
                case ".svg":
                    return "image/svg+xml";
                case ".ico":
                    return "image/x-icon";
                default:
                    return "application/octet-stream";
            }
        }

        private static string FindBrowser()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (string p in candidates)
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }
    }
}
