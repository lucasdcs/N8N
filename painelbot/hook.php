<?php

use GlpiPlugin\Painelbot\Install;

function plugin_painelbot_install(): bool
{
    return Install::install();
}

function plugin_painelbot_uninstall(): bool
{
    return Install::uninstall();
}
