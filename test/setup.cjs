// The existing suite asserts Chinese messages; new English-mode coverage sets
// DIFF_VIZ_LANG=en explicitly in a child process or via setLanguage().
process.env.DIFF_VIZ_LANG = 'zh';
