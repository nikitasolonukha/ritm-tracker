$ErrorActionPreference = 'Stop'
$container = 'ritm-product-qa-20260930'
$database = 'ritm_qa_' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
docker exec $container createdb -U supabase_admin $database
if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated test database' }
function Invoke-SqlFile([string]$path) {
  Get-Content -Raw -LiteralPath $path | docker exec -i $container psql -U supabase_admin -d $database -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "SQL failed: $path" }
}
Invoke-SqlFile (Join-Path $PSScriptRoot '../supabase/tests/local-bootstrap.sql')
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '../supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object { Invoke-SqlFile $_.FullName }
Invoke-SqlFile (Join-Path $PSScriptRoot '../supabase/tests/product.sql')
Invoke-SqlFile (Join-Path $PSScriptRoot '../supabase/tests/habit-regressions.sql')
Invoke-SqlFile (Join-Path $PSScriptRoot '../supabase/tests/timer-snapshot.sql')
