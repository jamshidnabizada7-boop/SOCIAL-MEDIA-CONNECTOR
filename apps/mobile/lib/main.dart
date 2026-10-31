import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const apiBase = String.fromEnvironment('API_BASE_URL', defaultValue: 'https://app.myariahub.com');
const sessionStore = FlutterSecureStorage();
const navy = Color(0xFF101C35);
const gold = Color(0xFFE8B65A);

void main() => runApp(const SocialApp());

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override String toString() => message;
}

class SocialApi {
  final HttpClient _client = HttpClient();
  String? cookie;
  SocialApi() {
    if (Uri.tryParse(apiBase)?.scheme != 'https') {
      throw StateError('API_BASE_URL must use HTTPS');
    }
  }

  Future<Map<String, dynamic>> request(String method, String path, [Map<String, dynamic>? body]) async {
    try {
      final uri = Uri.parse(apiBase).resolve(path);
      if (uri.scheme != 'https' || uri.host != Uri.parse(apiBase).host) {
        throw ApiException('Unsafe API address');
      }
      final req = await _client.openUrl(method, uri).timeout(const Duration(seconds: 15));
      req.followRedirects = false;
      req.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (cookie != null) req.headers.set(HttpHeaders.cookieHeader, cookie!);
      if (body != null) {
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(body));
      }
      final res = await req.close().timeout(const Duration(seconds: 15));
      final setCookies = res.cookies.where((c) => c.name == 'aria_session').toList();
      if (setCookies.isNotEmpty) {
        final c = setCookies.last;
        cookie = c.value.isEmpty ? null : '${c.name}=${c.value}';
        if (cookie == null) {
          await sessionStore.delete(key: 'session');
        } else {
          await sessionStore.write(key: 'session', value: cookie);
        }
      }
      final text = await res.transform(utf8.decoder).join();
      final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
      if (decoded is! Map<String, dynamic>) throw ApiException('Invalid server response');
      if (res.statusCode < 200 || res.statusCode >= 300) {
        final error = decoded['error'];
        throw ApiException(error is Map ? (error['message']?.toString() ?? 'Request failed') : 'Request failed (${res.statusCode})');
      }
      return decoded;
    } on ApiException {
      rethrow;
    } on SocketException {
      throw ApiException('Cannot reach the server. Check your connection.');
    } on HandshakeException {
      throw ApiException('Secure connection failed.');
    } on FormatException {
      throw ApiException('Server returned invalid data.');
    } catch (_) {
      throw ApiException('Request failed. Please try again.');
    }
  }

  Future<void> restore() async { cookie = await sessionStore.read(key: 'session'); }
  Future<void> logout() async {
    try { await request('POST', '/v1/auth/logout'); } finally {
      cookie = null;
      await sessionStore.delete(key: 'session');
    }
  }
}

class SocialApp extends StatelessWidget {
  const SocialApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(
    title: 'All-in-One Social', debugShowCheckedModeBanner: false,
    theme: ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: navy), scaffoldBackgroundColor: const Color(0xFFF5F7FB),
      appBarTheme: const AppBarTheme(backgroundColor: navy, foregroundColor: Colors.white)),
    home: const SocialHome(),
  );
}

class SocialHome extends StatefulWidget {
  const SocialHome({super.key});
  @override State<SocialHome> createState() => _SocialHomeState();
}

class _SocialHomeState extends State<SocialHome> {
  final api = SocialApi();
  final email = TextEditingController(), password = TextEditingController(), name = TextEditingController();
  bool loading = true, register = false, signedIn = false;
  String? error, workspace;
  List<dynamic> workspaces = [], accounts = [], inbox = [];
  int tab = 0;

  @override void initState() { super.initState(); bootstrap(); }
  @override void dispose() { email.dispose(); password.dispose(); name.dispose(); super.dispose(); }

  Future<void> bootstrap() async {
    try {
      await api.restore();
      if (api.cookie != null) await loadMe();
    } catch (_) {
      await sessionStore.delete(key: 'session');
      api.cookie = null;
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> loadMe() async {
    final data = await api.request('GET', '/v1/auth/me');
    final ws = data['workspaces'];
    workspaces = ws is List ? ws : [];
    workspace = workspaces.isEmpty ? null : workspaces.first['workspaceId']?.toString();
    signedIn = true;
    await refresh();
  }

  Future<void> login() async {
    if (email.text.trim().isEmpty || password.text.isEmpty || (register && name.text.trim().length < 2)) {
      setState(() => error = 'Enter valid account details.');
      return;
    }
    setState(() { loading = true; error = null; });
    try {
      await api.request('POST', register ? '/v1/auth/register' : '/v1/auth/login', {
        'email': email.text.trim(), 'password': password.text,
        if (register) 'name': name.text.trim(),
      });
      password.clear();
      await loadMe();
    } catch (e) {
      setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> refresh() async {
    if (workspace == null) {
      if (mounted) setState(() { accounts = []; inbox = []; });
      return;
    }
    try {
      final a = await api.request('GET', '/v1/workspaces/$workspace/accounts');
      final i = await api.request('GET', '/v1/workspaces/$workspace/inbox?limit=30');
      if (mounted) setState(() {
        accounts = a['accounts'] is List ? a['accounts'] : [];
        inbox = i['items'] is List ? i['items'] : [];
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> signOut() async {
    try { await api.logout(); } catch (_) {}
    if (mounted) setState(() { signedIn = false; accounts = []; inbox = []; workspaces = []; workspace = null; error = null; });
  }

  @override Widget build(BuildContext context) {
    if (loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (!signedIn) return Scaffold(body: SafeArea(child: Center(child: SingleChildScrollView(
      padding: const EdgeInsets.all(24), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 430),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Icon(Icons.hub_rounded, size: 62, color: navy), const SizedBox(height: 16),
        const Text('All-in-One Social', textAlign: TextAlign.center, style: TextStyle(fontSize: 30, fontWeight: FontWeight.bold, color: navy)),
        const SizedBox(height: 8),
        const Text('Your connected accounts in one place', textAlign: TextAlign.center),
        const SizedBox(height: 35),
        if (register) TextField(controller: name, decoration: const InputDecoration(labelText: 'Full name', border: OutlineInputBorder())),
        if (register) const SizedBox(height: 12),
        TextField(controller: email, keyboardType: TextInputType.emailAddress, autocorrect: false,
          decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(controller: password, obscureText: true, enableSuggestions: false,
          decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder())),
        if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(error!, style: const TextStyle(color: Colors.red))),
        const SizedBox(height: 16),
        FilledButton(onPressed: login, child: Padding(padding: const EdgeInsets.all(13), child: Text(register ? 'Create account' : 'Sign in'))),
        TextButton(onPressed: () => setState(() { register = !register; error = null; }),
          child: Text(register ? 'Already registered? Sign in' : 'New here? Create account')),
      ])),
    ))));
    return Scaffold(
      appBar: AppBar(title: const Text('All-in-One Social'), actions: [
        IconButton(tooltip: 'Refresh', onPressed: refresh, icon: const Icon(Icons.refresh)),
        IconButton(tooltip: 'Sign out', onPressed: signOut, icon: const Icon(Icons.logout)),
      ]),
      body: Column(children: [
        if (workspaces.length > 1) Padding(padding: const EdgeInsets.all(12),
          child: DropdownButtonFormField<String>(initialValue: workspace,
            decoration: const InputDecoration(labelText: 'Workspace', border: OutlineInputBorder()),
            items: workspaces.map((w) => DropdownMenuItem(value: w['workspaceId'].toString(), child: Text(w['name']?.toString() ?? 'Workspace'))).toList(),
            onChanged: (v) async { setState(() { workspace = v; accounts = []; inbox = []; }); await refresh(); })),
        if (error != null) Padding(padding: const EdgeInsets.all(12), child: Text(error!, style: const TextStyle(color: Colors.red))),
        Expanded(child: RefreshIndicator(onRefresh: refresh, child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(tab == 0 ? 'Connected accounts' : 'Unified Inbox',
              style: const TextStyle(fontSize: 25, fontWeight: FontWeight.bold, color: navy)),
            const SizedBox(height: 6),
            Text(tab == 0 ? 'Live accounts from your workspace' : 'Read-only interactions supported by the connected platforms'),
            const SizedBox(height: 16),
            if (tab == 0 && accounts.isEmpty) const _EmptyMessage('No connected accounts yet. Connect accounts using the existing web dashboard.'),
            if (tab == 1 && inbox.isEmpty) const _EmptyMessage('No inbox activity available for this workspace.'),
            if (tab == 0) ...accounts.map((a) => Card(child: ListTile(
              leading: const CircleAvatar(backgroundColor: navy, child: Icon(Icons.account_circle, color: gold)),
              title: Text(a['displayName']?.toString() ?? a['providerId']?.toString() ?? 'Account'),
              subtitle: Text('${a['providerId'] ?? ''} · ${a['handle'] ?? ''}'),
              trailing: Text(a['connection']?.toString().replaceAll('_', ' ') ?? 'unknown',
                style: TextStyle(color: a['connection'] == 'healthy' ? Colors.green.shade700 : Colors.orange.shade800)),
            ))),
            if (tab == 1) ...inbox.map((item) => Card(child: ListTile(
              leading: const Icon(Icons.chat_bubble_outline),
              title: Text(item['sender'] is Map ? (item['sender']['name']?.toString() ?? 'Activity') : (item['provider']?.toString() ?? 'Activity')),
              subtitle: Text(item['text']?.toString() ?? 'No message text', maxLines: 3, overflow: TextOverflow.ellipsis),
              trailing: Text(item['provider']?.toString() ?? ''),
            ))),
          ],
        ))),
      ]),
      bottomNavigationBar: NavigationBar(selectedIndex: tab, onDestinationSelected: (v) => setState(() => tab = v),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Accounts'),
          NavigationDestination(icon: Icon(Icons.inbox_outlined), selectedIcon: Icon(Icons.inbox), label: 'Inbox'),
        ]),
    );
  }
}

class _EmptyMessage extends StatelessWidget {
  final String message;
  const _EmptyMessage(this.message);
  @override Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 64, horizontal: 18),
    child: Column(children: [
      const Icon(Icons.info_outline, size: 48, color: Colors.blueGrey),
      const SizedBox(height: 12), Text(message, textAlign: TextAlign.center),
    ]),
  );
}
