import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:aria_social_mobile/main.dart';

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('Login screen renders without demo accounts', (tester) async {
    await tester.pumpWidget(const SocialApp());
    await tester.pumpAndSettle();
    expect(find.text('All-in-One Social'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Connected accounts'), findsNothing);
    expect(find.byType(TextField), findsNWidgets(2));
  });
}
