// nxpatch — reads Nintendo Switch NSP files for NSPtoNUP (built on LibHac).
// NCAs are read directly from the NSP; nothing is unpacked to disk first.
//
// Usage (-k is prod.keys; --titlekeys is an optional title.keys):
//   nxpatch identify -k <prod.keys> <nsp>...
//       Identifies each NSP. One tab-separated line per file:
//         content <path> <base|update|dlc> <title id> <version>
//         error   <path> <code> <detail> <message>
//   nxpatch control -k <prod.keys> [--titlekeys <file>] --nsp <nsp> --out <dir>
//       Extracts the romfs of the Control NCA (control.nacp, icon_*.dat).
//   nxpatch extract -k <prod.keys> [--titlekeys <file>] --base <nsp> [--update <nsp>] [--dlc <nsp>]... --out <dir>
//       Writes the nup dump layout: base/{exefs,romfs}, updates/<version>/{exefs,romfs}, dlc/<title id>/0/romfs.
//       Updates use the newer BKTR format and are combined with the base into complete patched content.
//       Output lines:
//         total    <bytes>
//         part     <base|update|dlc> <exefs|romfs> <file count> <revision or title id>
//         progress <bytes done>
//
// Title keys: common tickets (.tik) inside the NSP come first (personalized tickets cannot be used),
// then title.keys. Key values are never printed.
//
// Errors are written to stderr as one tab-separated line and the exit code is 1:
//   nxpatch-error <code> <detail> <message>
// Invalid arguments print the usage and exit with code 2. See README.md for the list of error codes.

using System.Buffers.Binary;
using LibHac;
using LibHac.Common;
using LibHac.Common.Keys;
using LibHac.Fs;
using LibHac.Fs.Fsa;
using LibHac.FsSystem;
using LibHac.Spl;
using LibHac.Tools.Fs;
using LibHac.Tools.FsSystem;
using LibHac.Tools.FsSystem.NcaUtils;

const string Usage = """
    Usage:
      nxpatch identify -k <prod.keys> <nsp>...
      nxpatch control -k <prod.keys> [--titlekeys <file>] --nsp <nsp> --out <dir>
      nxpatch extract -k <prod.keys> [--titlekeys <file>] --base <nsp> [--update <nsp>] [--dlc <nsp>]... --out <dir>
    """;

if (args.Length == 0) { Console.Error.WriteLine(Usage); return 2; }
string command = args[0];
var single = new Dictionary<string, string>();
var multi = new Dictionary<string, List<string>>();
var positional = new List<string>();
for (int i = 1; i < args.Length; i++)
{
    string arg = args[i];
    if (!arg.StartsWith("-")) { positional.Add(arg); continue; }
    if (i + 1 >= args.Length) { Console.Error.WriteLine($"Missing value for {arg}\n{Usage}"); return 2; }
    string value = args[++i];
    single[arg] = value;
    if (!multi.TryGetValue(arg, out var list)) multi[arg] = list = new List<string>();
    list.Add(value);
}
string? Option(string name) => single.TryGetValue(name, out var value) ? value : null;
List<string> Options(string name) => multi.TryGetValue(name, out var values) ? values : new List<string>();

string? keysPath = Option("-k");
if (keysPath is null) { Console.Error.WriteLine(Usage); return 2; }

try
{
    switch (command)
    {
        case "identify":
        {
            if (positional.Count == 0) { Console.Error.WriteLine(Usage); return 2; }
            var keySet = Keys.Load(keysPath, null);
            foreach (string path in positional)
            {
                try
                {
                    using var package = new Package(path, keySet);
                    var meta = package.ReadMeta();
                    Console.WriteLine($"content\t{path}\t{meta.Kind}\t{meta.TitleId:X16}\t{meta.Version}");
                }
                catch (Exception error)
                {
                    var failure = Failure.From(error);
                    Console.WriteLine($"error\t{path}\t{failure.Code}\t{failure.Detail}\t{failure.Message}");
                }
            }
            return 0;
        }

        case "control":
        {
            string? nsp = Option("--nsp"), output = Option("--out");
            if (nsp is null || output is null) { Console.Error.WriteLine(Usage); return 2; }
            var keySet = Keys.Load(keysPath, Option("--titlekeys"));
            using var package = new Package(nsp, keySet);
            var control = package.FindNca(NcaContentType.Control)
                ?? throw new Failure("nca_not_found", "control", "No Control NCA found");
            using var romfs = control.OpenFileSystem(NcaSectionType.Data, IntegrityCheckLevel.None);
            Copier.Copy(romfs, output, null);
            return 0;
        }

        case "extract":
        {
            string? baseNsp = Option("--base"), output = Option("--out");
            if (baseNsp is null || output is null) { Console.Error.WriteLine(Usage); return 2; }
            var keySet = Keys.Load(keysPath, Option("--titlekeys"));
            return Extractor.Run(keySet, baseNsp, Option("--update"), Options("--dlc"), output);
        }

        default:
            Console.Error.WriteLine(Usage);
            return 2;
    }
}
catch (Exception error)
{
    var failure = Failure.From(error);
    Console.Error.WriteLine($"nxpatch-error\t{failure.Code}\t{failure.Detail}\t{failure.Message}");
    return 1;
}

/// An error with a stable code (for callers to localize), an optional detail and an English message.
sealed class Failure(string code, string detail, string message) : Exception(message)
{
    public string Code { get; } = code;
    public string Detail { get; } = detail;

    /// Maps any exception to a failure; only the reason is reported, never a stack trace or key value.
    public static Failure From(Exception error) => error switch
    {
        Failure failure => failure,
        MissingKeyException missing when missing.Type == LibHac.Common.Keys.KeyType.Title => new Failure(
            "missing_title_key", missing.Name ?? "",
            $"No title key: the NSP has no usable common ticket and title.keys has no entry (rights ID {missing.Name})"),
        MissingKeyException missing => new Failure(
            "missing_key", missing.Name ?? "",
            $"prod.keys is missing {missing.Name}; use prod.keys that match the game's firmware version"),
        _ => new Failure("unknown", "", OneLine(error.Message)),
    };

    private static string OneLine(string text) => text.Replace('\t', ' ').Replace('\n', ' ').Replace('\r', ' ');
}

static class Keys
{
    private static string? titleKeysFile;
    private static readonly HashSet<KeySet> loadedTitleKeys = new();

    /// Reads prod.keys only. title.keys is loaded after the NSP's tickets are imported,
    /// so a rights ID that already has a key from a ticket is not overwritten (tickets take priority).
    public static KeySet Load(string prodKeys, string? titleKeys)
    {
        var keySet = KeySet.CreateDefaultKeySet();
        ExternalKeyReader.ReadKeyFile(keySet, prodKeys, null, null, logger: null);
        titleKeysFile = titleKeys;
        return keySet;
    }

    public static void LoadTitleKeysOnce(KeySet keySet)
    {
        if (titleKeysFile is null || !loadedTitleKeys.Add(keySet)) return;
        ExternalKeyReader.ReadKeyFile(keySet, null, titleKeysFile, null, logger: null);
    }

    /// Common ticket (title key type 0): rights ID at body+0x160, encrypted title key at body+0x40.
    public static void ImportTicket(KeySet keySet, byte[] ticket)
    {
        if (ticket.Length < 4) return;
        int body = BinaryPrimitives.ReadUInt32LittleEndian(ticket) switch
        {
            0x10000 or 0x10003 => 0x240,
            0x10001 or 0x10004 => 0x140,
            0x10002 or 0x10005 => 0x80,
            _ => -1,
        };
        if (body < 0 || ticket.Length < body + 0x170 || ticket[body + 0x141] != 0) return;
        var rightsId = new RightsId(ticket.AsSpan(body + 0x160, 0x10));
        var key = new AccessKey(ticket.AsSpan(body + 0x40, 0x10));
        keySet.ExternalKeySet.Add(rightsId, key);
    }
}

/// One NSP: the NCAs and tickets inside its PFS0.
sealed class Package : IDisposable
{
    public readonly string Path;
    private readonly KeySet keySet;
    private readonly LocalStorage storage;
    private readonly PartitionFileSystem pfs = new();
    private readonly List<string> names;

    public Package(string path, KeySet keySet)
    {
        Path = path;
        this.keySet = keySet;
        storage = new LocalStorage(path, FileAccess.Read);
        if (pfs.Initialize(storage).IsFailure()) throw new Failure("invalid_nsp", "", "Not a valid NSP file");
        names = pfs.EnumerateEntries("/", "*").Where(e => e.Type == DirectoryEntryType.File).Select(e => e.Name).ToList();
        if (names.Any(n => n.EndsWith(".ncz")))
            throw new Failure("nsz_unsupported", "", "This is an NSZ package; decompress it to NSP first");
        foreach (string name in names.Where(n => n.EndsWith(".tik"))) Keys.ImportTicket(keySet, ReadAll(name));
        Keys.LoadTitleKeysOnce(keySet);
    }

    private IStorage OpenStorage(string name)
    {
        using var file = new UniqueRef<IFile>();
        pfs.OpenFile(ref file.Ref, ("/" + name).ToU8Span(), OpenMode.Read).ThrowIfFailure();
        return new FileStorage(file.Release());
    }

    private byte[] ReadAll(string name)
    {
        using var file = OpenStorage(name);
        file.GetSize(out long size).ThrowIfFailure();
        var data = new byte[size];
        file.Read(0, data).ThrowIfFailure();
        return data;
    }

    public Nca OpenNca(string name) => new(keySet, OpenStorage(name));

    /// Finds an NCA by content type (skipping the Meta NCA); returns the largest when there are several.
    public Nca? FindNca(params NcaContentType[] types)
    {
        Nca? best = null;
        long bestSize = -1;
        foreach (string name in names.Where(n => n.EndsWith(".nca") && !n.EndsWith(".cnmt.nca")))
        {
            var nca = OpenNca(name);
            if (!types.Contains(nca.Header.ContentType)) continue;
            nca.BaseStorage.GetSize(out long size).ThrowIfFailure();
            if (size > bestSize) { best = nca; bestSize = size; }
        }
        return best;
    }

    public record Meta(string Kind, ulong TitleId, uint Version);

    /// cnmt header: TitleId u64 @0x0, Version u32 @0x8, Type u8 @0xC (0x80 base, 0x81 update, 0x82 DLC).
    public Meta ReadMeta()
    {
        string metaName = names.FirstOrDefault(n => n.EndsWith(".cnmt.nca"))
            ?? throw new Failure("no_cnmt", "", "No content metadata (cnmt) found in the NSP");
        var nca = OpenNca(metaName);
        using var fs = nca.OpenFileSystem(0, IntegrityCheckLevel.None);
        var entry = fs.EnumerateEntries("/", "*.cnmt").FirstOrDefault()
            ?? throw new Failure("bad_cnmt", "", "The content metadata is damaged");
        using var file = new UniqueRef<IFile>();
        fs.OpenFile(ref file.Ref, entry.FullPath.ToU8Span(), OpenMode.Read).ThrowIfFailure();
        var header = new byte[0x10];
        file.Get.Read(out long read, 0, header).ThrowIfFailure();
        if (read < 0x0D) throw new Failure("bad_cnmt", "", "The content metadata is damaged");
        string kind = header[0x0C] switch
        {
            0x80 => "base",
            0x81 => "update",
            0x82 => "dlc",
            _ => throw new Failure("unsupported_type", $"0x{header[0x0C]:X2}",
                "Unsupported content type (only base games, updates and DLC are supported)"),
        };
        return new Meta(kind, BinaryPrimitives.ReadUInt64LittleEndian(header), BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(8)));
    }

    public void Dispose() => storage.Dispose();
}

/// Copies a file system to a local directory and reports progress in bytes.
sealed class Copier : IProgressReport
{
    private readonly Action<long>? onProgress;
    private long done;

    private Copier(Action<long>? onProgress) { this.onProgress = onProgress; }

    public static long TotalSize(IFileSystem fs) =>
        fs.EnumerateEntries("/", "*", SearchOptions.RecurseSubdirectories).Where(e => e.Type == DirectoryEntryType.File).Sum(e => e.Size);

    public static int FileCount(IFileSystem fs) =>
        fs.EnumerateEntries("/", "*", SearchOptions.RecurseSubdirectories).Count(e => e.Type == DirectoryEntryType.File);

    public static void Copy(IFileSystem source, string directory, Action<long>? onProgress)
    {
        Directory.CreateDirectory(directory);
        using var target = new LocalFileSystem(directory);
        source.CopyDirectory(target, "/", "/", new Copier(onProgress)).ThrowIfFailure();
    }

    public void Report(long value) { }
    public void ReportAdd(long value) { done += value; onProgress?.Invoke(done); }
    public void SetTotal(long value) { }
    public void LogMessage(string message) { }
}

static class Extractor
{
    public static int Run(KeySet keySet, string basePath, string? updatePath, List<string> dlcPaths, string output)
    {
        using var basePackage = new Package(basePath, keySet);
        var baseMeta = basePackage.ReadMeta();
        if (baseMeta.Kind != "base")
            throw new Failure("not_base", baseMeta.Kind,
                $"This is {(baseMeta.Kind == "update" ? "an update" : "DLC")} ({baseMeta.TitleId:X16}), not a base game");
        var baseNca = basePackage.FindNca(NcaContentType.Program)
            ?? throw new Failure("nca_not_found", "program", "No Program NCA found; this NSP may not be a base game");

        // Content to extract: (kind, section, revision or title id, file system, target directory)
        var jobs = new List<(string Kind, string Section, string Id, IFileSystem Fs, string Dir)>();
        var packages = new List<Package>();
        void Add(string kind, string id, Nca nca, Nca? patch, NcaSectionType type, string dir)
        {
            bool available = nca.CanOpenSection(type) || (patch?.CanOpenSection(type) ?? false);
            if (!available) return;
            var fs = patch is null ? nca.OpenFileSystem(type, IntegrityCheckLevel.None)
                                   : nca.OpenFileSystemWithPatch(patch, type, IntegrityCheckLevel.None);
            jobs.Add((kind, type == NcaSectionType.Code ? "exefs" : "romfs", id, fs, dir));
        }

        Add("base", "", baseNca, null, NcaSectionType.Code, System.IO.Path.Combine(output, "base", "exefs"));
        Add("base", "", baseNca, null, NcaSectionType.Data, System.IO.Path.Combine(output, "base", "romfs"));

        if (updatePath is not null)
        {
            var package = new Package(updatePath, keySet);
            packages.Add(package);
            var meta = package.ReadMeta();
            if (meta.Kind != "update" || (meta.TitleId & ~0x1FFFUL) != baseMeta.TitleId)
                throw new Failure("update_mismatch", System.IO.Path.GetFileName(updatePath),
                    $"{System.IO.Path.GetFileName(updatePath)} is not an update for this game");
            var patch = package.FindNca(NcaContentType.Program)
                ?? throw new Failure("nca_not_found", "program", "No Program NCA found in the update");
            string dir = System.IO.Path.Combine(output, "updates", meta.Version.ToString());
            string revision = (meta.Version >> 16).ToString();
            Add("update", revision, baseNca, patch, NcaSectionType.Code, System.IO.Path.Combine(dir, "exefs"));
            Add("update", revision, baseNca, patch, NcaSectionType.Data, System.IO.Path.Combine(dir, "romfs"));
        }

        foreach (string dlcPath in dlcPaths)
        {
            var package = new Package(dlcPath, keySet);
            packages.Add(package);
            var meta = package.ReadMeta();
            if (meta.Kind != "dlc" || (meta.TitleId & ~0x1FFFUL) != baseMeta.TitleId)
                throw new Failure("dlc_mismatch", System.IO.Path.GetFileName(dlcPath),
                    $"{System.IO.Path.GetFileName(dlcPath)} is not DLC for this game");
            var data = package.FindNca(NcaContentType.PublicData, NcaContentType.Data)
                ?? throw new Failure("nca_not_found", "data", $"No data NCA found in DLC {meta.TitleId:X16}");
            Add("dlc", meta.TitleId.ToString("X16"), data, null, NcaSectionType.Data,
                System.IO.Path.Combine(output, "dlc", meta.TitleId.ToString("X16"), "0", "romfs"));
        }

        long total = jobs.Sum(job => Copier.TotalSize(job.Fs));
        Console.WriteLine($"total\t{total}");
        long finished = 0, reported = 0;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        foreach (var job in jobs)
        {
            Console.WriteLine($"part\t{job.Kind}\t{job.Section}\t{Copier.FileCount(job.Fs)}\t{job.Id}");
            long start = finished;
            Copier.Copy(job.Fs, job.Dir, done =>
            {
                finished = start + done;
                // At most one progress line every 0.25 seconds
                if (clock.ElapsedMilliseconds - reported < 250) return;
                reported = clock.ElapsedMilliseconds;
                Console.WriteLine($"progress\t{finished}");
            });
            job.Fs.Dispose();
        }
        Console.WriteLine($"progress\t{total}");
        packages.ForEach(package => package.Dispose());
        return 0;
    }
}
