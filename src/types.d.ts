/**
 * Side-effect stylesheet imports carry no types of their own. Declared here rather than pulled in
 * from `vite/client`, because that types file also declares Vite's build-time environment object —
 * and this app has no build-time configuration to read. Leaving it undeclared makes the rule a
 * compiler error as well as a test. (Nor is the object named here: the grep in
 * test/no-build-time-config.test.ts covers every file in src, including this one.)
 */
declare module '*.css'
