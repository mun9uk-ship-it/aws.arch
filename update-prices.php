<?php
/**
 * Velo Advisor – AWS price updater (run from a Plesk Scheduled Task, e.g. weekly).
 *
 * Two keyless-vs-keyed modes:
 *  1) API mode  (needs a free IAM user with pricing:GetProducts) – EC2, RDS, S3, Lambda.
 *     Put credentials in config.php (see config.sample.php). The Pricing API itself has no charge.
 *  2) Bulk mode (no credentials) – downloads the public Price List files for SMALL services
 *     (S3, Lambda). Large files (EC2, RDS) are skipped here because they can be hundreds of MB.
 * Anything not fetched keeps the labelled approximate fallback in assets/app.js.
 *
 * Output: data/prices.json  { meta:{source,updated,live:[...]}, unit:{ region:{ key:usd } } }
 * CLI:  php update-prices.php          Web (protected): update-prices.php?token=YOUR_TOKEN
 */
@set_time_limit(0); @ini_set('memory_limit','1024M');
$cfg = file_exists(__DIR__.'/config.php') ? include __DIR__.'/config.php' : [];
if (PHP_SAPI !== 'cli') {
  $tok = $cfg['web_token'] ?? '';
  if ($tok === '' || !hash_equals($tok, $_GET['token'] ?? '')) { http_response_code(403); exit('Forbidden'); }
  header('Content-Type: text/plain');
}
$regions = [
 'us-east-1'=>'US East (N. Virginia)','us-east-2'=>'US East (Ohio)','us-west-1'=>'US West (N. California)','us-west-2'=>'US West (Oregon)',
 'ca-central-1'=>'Canada (Central)','sa-east-1'=>'South America (Sao Paulo)','eu-west-1'=>'EU (Ireland)','eu-west-2'=>'EU (London)',
 'eu-west-3'=>'EU (Paris)','eu-central-1'=>'EU (Frankfurt)','eu-north-1'=>'EU (Stockholm)','eu-south-1'=>'EU (Milan)',
 'me-south-1'=>'Middle East (Bahrain)','me-central-1'=>'Middle East (UAE)','af-south-1'=>'Africa (Cape Town)',
 'ap-south-1'=>'Asia Pacific (Mumbai)','ap-southeast-1'=>'Asia Pacific (Singapore)','ap-southeast-2'=>'Asia Pacific (Sydney)',
 'ap-northeast-1'=>'Asia Pacific (Tokyo)','ap-northeast-2'=>'Asia Pacific (Seoul)','ap-east-1'=>'Asia Pacific (Hong Kong)','il-central-1'=>'Israel (Tel Aviv)'
];
$out = ['meta'=>['source'=>'fallback','updated'=>gmdate('Y-m-d'),'live'=>[]],'unit'=>[],'fx'=>(object)[]];
$old = @json_decode(@file_get_contents(__DIR__.'/data/prices.json'), true);
if (is_array($old) && !empty($old['unit'])) $out['unit'] = $old['unit']; // keep previous values if a run partly fails
function logm($m){ echo $m."\n"; @file_put_contents(__DIR__.'/data/update.log', gmdate('c').' '.$m."\n", FILE_APPEND); }
@file_put_contents(__DIR__.'/data/update.log','');

/* ---------- API mode: SigV4 signed GetProducts ---------- */
function sigv4($cfg, $target, $payload) {
  $host='api.pricing.us-east-1.amazonaws.com'; $region='us-east-1'; $service='pricing';
  $amz = gmdate('Ymd\THis\Z'); $date = gmdate('Ymd');
  $hdrs = ['content-type'=>'application/x-amz-json-1.1','host'=>$host,'x-amz-date'=>$amz,'x-amz-target'=>$target];
  ksort($hdrs); $canon=''; $signed='';
  foreach ($hdrs as $k=>$v){ $canon.="$k:$v\n"; $signed.=($signed?';':'').$k; }
  $creq = "POST\n/\n\n$canon\n$signed\n".hash('sha256',$payload);
  $scope = "$date/$region/$service/aws4_request";
  $sts = "AWS4-HMAC-SHA256\n$amz\n$scope\n".hash('sha256',$creq);
  $k = hash_hmac('sha256',$date,'AWS4'.$cfg['aws_secret'],true);
  foreach ([$region,$service,'aws4_request'] as $p) $k = hash_hmac('sha256',$p,$k,true);
  $sig = hash_hmac('sha256',$sts,$k);
  $auth = "AWS4-HMAC-SHA256 Credential={$cfg['aws_key']}/$scope, SignedHeaders=$signed, Signature=$sig";
  $h = []; foreach ($hdrs as $k2=>$v2) if ($k2!=='host') $h[]="$k2: $v2"; $h[]="Authorization: $auth";
  $ch = curl_init("https://$host/"); curl_setopt_array($ch,[CURLOPT_POST=>1,CURLOPT_POSTFIELDS=>$payload,CURLOPT_HTTPHEADER=>$h,CURLOPT_RETURNTRANSFER=>1,CURLOPT_TIMEOUT=>60]);
  $r = curl_exec($ch); curl_close($ch); return $r ? json_decode($r,true) : null;
}
function api_price($cfg,$svc,$filters) {
  $f=[]; foreach($filters as $k=>$v) $f[]=['Type'=>'TERM_MATCH','Field'=>$k,'Value'=>$v];
  $res = sigv4($cfg,'AWSPriceListService.GetProducts', json_encode(['ServiceCode'=>$svc,'Filters'=>$f,'FormatVersion'=>'aws_v1','MaxResults'=>10]));
  if (!$res || empty($res['PriceList'])) return null;
  foreach ($res['PriceList'] as $item) {
    $p = is_string($item)?json_decode($item,true):$item;
    foreach (($p['terms']['OnDemand']??[]) as $t) foreach ($t['priceDimensions'] as $d) {
      $usd = (float)($d['pricePerUnit']['USD']??0); if ($usd>0) return $usd;
    }
  } return null;
}
/* key => [serviceCode, filters(location added), multiplier] */
$apiQueries = [
 'ec2_small'=>['AmazonEC2',['instanceType'=>'t3.small','operatingSystem'=>'Linux','tenancy'=>'Shared','preInstalled'=>'NA','capacitystatus'=>'Used']],
 'ec2_med'  =>['AmazonEC2',['instanceType'=>'t3.medium','operatingSystem'=>'Linux','tenancy'=>'Shared','preInstalled'=>'NA','capacitystatus'=>'Used']],
 'ec2_m6i_l'=>['AmazonEC2',['instanceType'=>'m6i.large','operatingSystem'=>'Linux','tenancy'=>'Shared','preInstalled'=>'NA','capacitystatus'=>'Used']],
 'rds_med_hr_raw'=>['AmazonRDS',['instanceType'=>'db.t4g.medium','databaseEngine'=>'PostgreSQL','deploymentOption'=>'Single-AZ']],
 's3_gb'    =>['AmazonS3',['storageClass'=>'General Purpose','volumeType'=>'Standard']],
 'lam_req'  =>['AWSLambda',['group'=>'AWS-Lambda-Requests']],
 'lam_gbs'  =>['AWSLambda',['group'=>'AWS-Lambda-Duration']],
];
$haveKeys = !empty($cfg['aws_key']) && !empty($cfg['aws_secret']);
if ($haveKeys) {
  logm('API mode');
  foreach ($regions as $code=>$loc) {
    foreach ($apiQueries as $key=>$q) {
      $filters = $q[1]; $filters['location']=$loc;
      $v = api_price($cfg,$q[0],$filters);
      if ($v===null) { logm("  miss $code $key"); continue; }
      if ($key==='lam_req') $v *= 1000000;               // API gives per request
      $k = $key==='rds_med_hr_raw' ? 'rds_med_hr' : $key;
      $out['unit'][$code][$k] = round($v, 8);
      if (!in_array($k,$out['meta']['live'])) $out['meta']['live'][]=$k;
      usleep(150000);
    }
    logm("  done $code");
  }
  $out['meta']['source']='aws';
}
/* ---------- Bulk mode (no credentials): small services only ---------- */
function bulk_json($svc,$code){
  $tmp = tempnam(sys_get_temp_dir(),'aws'); $fp=fopen($tmp,'w');
  $ch=curl_init("https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/$svc/current/$code/index.json");
  curl_setopt_array($ch,[CURLOPT_FILE=>$fp,CURLOPT_TIMEOUT=>300,CURLOPT_FOLLOWLOCATION=>1]); $ok=curl_exec($ch); $http=curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch); fclose($fp);
  $j = ($ok && $http==200 && filesize($tmp) < 120*1024*1024) ? json_decode(file_get_contents($tmp),true) : null; @unlink($tmp); return $j;
}
function bulk_find($j,$attrs,$unit=null){
  foreach ($j['products']??[] as $sku=>$p) {
    $a=$p['attributes']??[]; $ok=true; foreach($attrs as $k=>$v) if(($a[$k]??null)!==$v){$ok=false;break;} if(!$ok) continue;
    foreach ($j['terms']['OnDemand'][$sku]??[] as $t) foreach ($t['priceDimensions'] as $d) {
      if ($unit && ($d['unit']??'')!==$unit) continue; if (isset($d['beginRange']) && $d['beginRange']!=='0') continue;
      $usd=(float)($d['pricePerUnit']['USD']??0); if($usd>0) return $usd; }
  } return null;
}
if (!$haveKeys) {
  logm('Bulk mode (no credentials): S3 + Lambda only');
  foreach ($regions as $code=>$loc) {
    $j = bulk_json('AmazonS3',$code);
    if ($j) { $v=bulk_find($j,['storageClass'=>'General Purpose','volumeType'=>'Standard'],'GB-Mo'); if($v){$out['unit'][$code]['s3_gb']=$v; $out['meta']['live']['s3_gb']='s3_gb';} }
    $j = bulk_json('AWSLambda',$code);
    if ($j) { $r=bulk_find($j,['group'=>'AWS-Lambda-Requests']); if($r){$out['unit'][$code]['lam_req']=$r*1000000;}
              $g=bulk_find($j,['group'=>'AWS-Lambda-Duration']); if($g){$out['unit'][$code]['lam_gbs']=$g;} }
    logm("  done $code"); unset($j);
  }
  $out['meta']['live']=['s3_gb','lam_req','lam_gbs']; $out['meta']['source']='aws';
}
file_put_contents(__DIR__.'/data/prices.json.tmp', json_encode($out, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
rename(__DIR__.'/data/prices.json.tmp', __DIR__.'/data/prices.json');
logm('Wrote data/prices.json at '.gmdate('c'));
