#!/usr/bin/env perl
# One-off migration: renames parser node names (string literals only) to the
# unified names. Identifiers (TS consts, Go Kind* constants) are untouched.
#
#   perl scripts/rename_nodes.pl $(git ls-files \
#     'frontend/src/features/noteEditor/parser/aspen/*.ts' \
#     'frontend/src/features/noteEditor/parser/aspen/rules/*.ts' \
#     'frontend/src/features/cardDescription/parseDescription.ts' \
#     'internal/parser/*.go')
use strict;
use warnings;

my %map = (
    WikiLink          => 'link',
    WikiLinkMark      => 'linkMark',
    ExternalLink      => 'urlLink',
    ExternalLinkMark  => 'urlLinkMark',
    Image             => 'image',
    LinkedImage       => 'imageLink',
    StrongImage       => 'strongImage',
    Icon              => 'icon',
    HashTag           => 'hashTag',
    BareUrl           => 'url',
    BareURL           => 'url',
    Blank             => 'blank',
    GoogleMap         => 'location',
    Indent            => 'indent',
    Quote             => 'quote',
    QuoteMark         => 'quoteMark',
    Strong            => 'strong',
    StrongMark        => 'strongMark',
    Code              => 'code',
    InlineCode        => 'code',
    CodeMark          => 'codeMark',
);
# Longest first, so WikiLinkMark is tried before WikiLink.
my $alt = join '|', sort { length($b) <=> length($a) } keys %map;

local $^I = '';
while (<>) {
    # Names inside double-quoted strings, including tree strings such as
    # "Document(Paragraph(WikiLink(WikiLinkMark,WikiLinkMark)))".
    s{"((?:[^"\\\n]|\\.)*)"}{
        my $s = $1;
        $s =~ s/\b($alt)\b/$map{$1}/g;
        "\"$s\"";
    }ge;

    # Unquoted object keys of the NodeProp tables in parser/aspen/index.ts.
    if ($ARGV =~ m{parser/aspen/index\.ts$}) {
        s/^(\s*)($alt)(:\s)/$1$map{$2}$3/;
    }
    print;
}
