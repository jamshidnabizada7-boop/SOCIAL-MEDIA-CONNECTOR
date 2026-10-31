import 'package:flutter_test/flutter_test.dart';
import 'package:aria_social_mobile/main.dart';

void main() {
  test('App starts with the real feed URL', () {
    expect(homeRoute, '/feed');
    expect(pageUrl(homeRoute).toString(), 'https://app.myariahub.com/feed');
  });

  test('Allows only the exact trusted HTTPS app origin', () {
    expect(isTrustedSiteUrl(Uri.parse('https://app.myariahub.com/inbox')), isTrue);
    expect(isTrustedSiteUrl(Uri.parse('http://app.myariahub.com/feed')), isFalse);
    expect(isTrustedSiteUrl(Uri.parse('https://app.myariahub.com.evil.test')), isFalse);
    expect(isTrustedSiteUrl(Uri.parse('https://other.myariahub.com/feed')), isFalse);
  });

  test('App exposes the production routes without fake provider capabilities', () {
    final routes = appSections.map((s) => s.path).toSet();
    expect(routes, containsAll([
      '/feed', '/explore', '/videos', '/inbox',
      '/accounts', '/composer', '/dashboard',
      '/posts', '/calendar', '/queue',
    ]));
    expect(routes.length, appSections.length);
  });
}
