import {
  EXPECTED_TEST_DB_CONTAINER,
  FORBIDDEN_DEV_DB_CONTAINER,
  assertResolvedTestContainer,
  isDbContainerRunning,
  prepareTestTarget,
  runSupabaseTest,
} from './supabase-test-shared.mjs'

function usage() {
  process.stdout.write(
    'Usage: node scripts/supabase-test-stack.mjs <start|stop|status>\n',
  )
}

function startStack() {
  const config = prepareTestTarget()
  if (isDbContainerRunning(config.containerName)) {
    assertResolvedTestContainer(config.containerName)
    process.stdout.write(
      `Supabase test already running (${config.containerName} @ ${config.apiHost}:${config.apiPort}).\n`,
    )
    return
  }

  process.stdout.write(
    `Starting Supabase test (${config.projectId}) on API ${config.apiPort} / DB ${config.dbPort}...\n`,
  )
  runSupabaseTest(['start'], { stdio: 'inherit' })
  assertResolvedTestContainer(EXPECTED_TEST_DB_CONTAINER)
  process.stdout.write(
    `Supabase test started: container ${EXPECTED_TEST_DB_CONTAINER}.\n`,
  )
}

function stopStack() {
  const config = prepareTestTarget()

  if (isDbContainerRunning(FORBIDDEN_DEV_DB_CONTAINER) && !isDbContainerRunning(config.containerName)) {
    process.stdout.write(
      `Note: development container ${FORBIDDEN_DEV_DB_CONTAINER} is running and will not be stopped.\n`,
    )
  }

  if (!isDbContainerRunning(config.containerName)) {
    process.stdout.write(
      `Supabase test stack is not running (${config.containerName}).\n`,
    )
    return
  }

  process.stdout.write(
    `Stopping Supabase test only (${config.containerName})...\n`,
  )
  runSupabaseTest(['stop'], { stdio: 'inherit' })
  process.stdout.write('Supabase test stopped.\n')
}

function statusStack() {
  const config = prepareTestTarget()
  const running = isDbContainerRunning(config.containerName)
  process.stdout.write(
    [
      `Supabase test project_id: ${config.projectId}`,
      `API: ${config.apiHost}:${config.apiPort}`,
      `DB: ${config.dbHost}:${config.dbPort}`,
      `Container: ${config.containerName}`,
      `Running: ${running ? 'yes' : 'no'}`,
      `Dev container ${FORBIDDEN_DEV_DB_CONTAINER} running: ${
        isDbContainerRunning(FORBIDDEN_DEV_DB_CONTAINER) ? 'yes' : 'no'
      }`,
      '',
    ].join('\n'),
  )

  if (running) {
    runSupabaseTest(['status'], { stdio: 'inherit' })
  }
}

function main() {
  const action = process.argv[2]
  if (!action || !['start', 'stop', 'status'].includes(action)) {
    usage()
    process.exit(action ? 1 : 0)
  }

  try {
    if (action === 'start') startStack()
    else if (action === 'stop') stopStack()
    else statusStack()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}

main()
