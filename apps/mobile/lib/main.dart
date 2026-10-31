import 'dart:async';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

// The server remains the source of truth. This app does not invent social data,
// emulate provider capabilities, or store passwords/provider access tokens.
const String siteOrigin = 'https://app.myariahub.com';
const String homeRoute = '/feed';

class AppSection {
  const AppSection(this.title, this.path, this.icon);
  final String title;
  final String path;
  final IconData icon;
}

const List<AppSection> appSections = [
  AppSection('Home Feed', '/feed', Icons.dynamic_feed_outlined),
  AppSection('Explore & Search', '/explore', Icons.search),
  AppSection('Videos', '/videos', Icons.play_circle_outline),
  AppSection('Social Inbox', '/inbox', Icons.inbox_outlined),
  AppSection('Connected Accounts', '/accounts', Icons.people_outline),
  AppSection('Create Post', '/composer', Icons.add_box_outlined),
  AppSection('Creator Studio', '/dashboard', Icons.dashboard_outlined),
  AppSection('Posts', '/posts', Icons.article_outlined),
  AppSection('Calendar', '/calendar', Icons.calendar_month_outlined),
  AppSection('Publishing Queue', '/queue', Icons.schedule_outlined),
];

bool isTrustedSiteUrl(Uri uri) =>
    uri.scheme == 'https' && uri.host.toLowerCase() == 'app.myariahub.com';

Uri pageUrl(String path) => Uri.parse(siteOrigin).resolve(path);

void main() => runApp(const SocialMobileApp());

class SocialMobileApp extends StatelessWidget {
  const SocialMobileApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'All-in-One Social',
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF006948)),
        ),
        home: const SocialBrowser(),
      );
}

class SocialBrowser extends StatefulWidget {
  const SocialBrowser({super.key});

  @override
  State<SocialBrowser> createState() => _SocialBrowserState();
}

class _SocialBrowserState extends State<SocialBrowser> {
  late final WebViewController _web;
  String _currentUrl = siteOrigin + homeRoute;
  int _progress = 0;
  String? _mainFrameError;

  @override
  void initState() {
    super.initState();

    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (value) {
          if (mounted) setState(() => _progress = value);
        },
        onPageStarted: (url) {
          if (!mounted) return;
          setState(() {
            _currentUrl = url;
            _mainFrameError = null;
          });
        },
        onPageFinished: (url) {
          if (mounted) {
            setState(() {
              _currentUrl = url;
              _progress = 100;
            });
          }
        },
        onWebResourceError: (error) {
          if (error.isForMainFrame ?? true) {
            if (mounted) {
              setState(() => _mainFrameError =
                  'This page could not load. Check your internet connection and retry.');
            }
          }
        },
        onNavigationRequest: (request) {
          if (!request.isMainFrame) {
            // Keep provider-supplied video players and embeds working.
            return NavigationDecision.navigate;
          }
          final uri = Uri.tryParse(request.url);
          if (uri == null) return NavigationDecision.prevent;
          if (isTrustedSiteUrl(uri) || uri.scheme == 'about') {
            return NavigationDecision.navigate;
          }
          // External social posts, OAuth providers and app links should use
          // the system browser/app. Do not pass session cookies to third parties.
          if (uri.scheme == 'https' || uri.scheme == 'http' ||
              uri.scheme == 'mailto' || uri.scheme == 'tel') {
            unawaited(_openExternal(uri));
          }
          return NavigationDecision.prevent;
        },
      ));

    if (_web.platform is AndroidWebViewController) {
      final android = _web.platform as AndroidWebViewController;
      unawaited(android.setMediaPlaybackRequiresUserGesture(false));
      unawaited(android.setAllowContentAccess(true));
      unawaited(android.setOnShowFileSelector((params) async {
        try {
          final result = await FilePicker.platform.pickFiles(
            allowMultiple: params.mode == FileSelectorMode.openMultiple,
            type: FileType.any,
          );
          if (result == null) return <String>[];
          return result.files
              .where((file) => file.path != null)
              .map((file) => Uri.file(file.path!).toString())
              .toList();
        } catch (_) {
          return <String>[];
        }
      }));
    }
    unawaited(_web.loadRequest(pageUrl(homeRoute)));
  }

  Future<void> _openExternal(Uri uri) async {
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Cannot open this link.')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Cannot open this link.')));
      }
    }
  }

  Future<void> _navigate(String path) async {
    if (path == 'browser') {
      final uri = Uri.tryParse(_currentUrl);
      if (uri != null && isTrustedSiteUrl(uri)) {
        await _openExternal(uri);
      } else {
        await _openExternal(pageUrl(homeRoute));
      }
      return;
    }
    if (path == 'reload') {
      await _web.reload();
      return;
    }
    await _web.loadRequest(pageUrl(path));
  }

  Future<void> _handleSystemBack() async {
    if (await _web.canGoBack()) {
      await _web.goBack();
    } else {
      await SystemNavigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) unawaited(_handleSystemBack());
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('All-in-One Social'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh page',
              onPressed: () => _navigate('reload'),
            ),
            IconButton(
              icon: const Icon(Icons.open_in_browser),
              tooltip: 'Open in Chrome (for external account connections)',
              onPressed: () => _navigate('browser'),
            ),
            PopupMenuButton<String>(
              tooltip: 'All tools',
              icon: const Icon(Icons.menu),
              onSelected: (value) => unawaited(_navigate(value)),
              itemBuilder: (context) => [
                for (final section in appSections)
                  PopupMenuItem<String>(
                    value: section.path,
                    child: Row(children: [
                      Icon(section.icon, size: 19),
                      const SizedBox(width: 12),
                      Text(section.title),
                    ]),
                  ),
              ],
            ),
          ],
        ),
        body: Stack(
          children: [
            WebViewWidget(controller: _web),
            if (_progress < 100 && _mainFrameError == null)
              LinearProgressIndicator(value: _progress / 100),
            if (_mainFrameError != null)
              ColoredBox(
                color: Theme.of(context).scaffoldBackgroundColor,
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.wifi_off, size: 52),
                        const SizedBox(height: 16),
                        Text(_mainFrameError!, textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: () => _navigate('reload'),
                          child: const Text('Retry'),
                        ),
                        TextButton(
                          onPressed: () => _navigate('browser'),
                          child: const Text('Open website in Chrome'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
