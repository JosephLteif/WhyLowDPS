'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeHeader, decodeNodeSelections, decodeNodes } from '../lib/talentDecode';
import type { NodeSelection } from '../lib/talentDecode';
import { encodeTalentString } from '../lib/talentEncode';
import {
  canSelectNode,
  canDeselectNode,
  toggleNode,
  decrementNode,
  cycleChoice,
  getPointsSpent,
  getActiveSubTreeId,
  CLASS_POINTS,
  SPEC_POINTS,
} from '../lib/talentRules';
import { useTalentTree } from '../lib/useTalentTree';
import type { TalentNode, TalentTreeData } from '../lib/useTalentTree';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

interface TalentTreeProps {
  talentString?: string;
  editable?: boolean;
  specId?: number;
  onTalentStringChange?: (s: string) => void;
  /** Render as a tiny inline preview — no card, no labels, no tooltips */
  mini?: boolean;
  /** Skip card wrapper (when rendered inside another card) */
  bare?: boolean;
}

// Node dimensions in SVG units (posX/posY use ~600 unit spacing)
const NODE_SIZE = 380;
const ICON_SIZE = 315;
const PADDING = 240;

const GOLD = '#C8992A';
const DIM = 'rgba(255,255,255,0.15)';
const DIM_ICON = 0.3;
const LOCKED_ICON = 0.15;

function filterRenderableNodes(
  nodes: TalentNode[],
  selections: Map<number, NodeSelection>
): TalentNode[] {
  return nodes.filter((node) => {
    const hasIcon = node.entries.some((entry) => !!entry?.icon);
    const isSelected = selections.has(node.id);
    return hasIcon || isSelected;
  });
}

export default function TalentTree({
  talentString,
  editable,
  specId: specIdProp,
  onTalentStringChange,
  mini,
  bare,
}: TalentTreeProps) {
  // In edit mode, freeze the initial talent string so prop changes don't re-decode
  const initialTalentRef = useRef(talentString);
  useEffect(() => {
    if (!editable) initialTalentRef.current = talentString;
  }, [editable, talentString]);

  const stableTalentString = editable ? initialTalentRef.current : talentString;

  const header = useMemo(() => {
    if (!stableTalentString) return null;
    try {
      return decodeHeader(stableTalentString);
    } catch {
      return null;
    }
  }, [stableTalentString]);

  const resolvedSpecId = specIdProp ?? header?.specId ?? null;
  const tree = useTalentTree(resolvedSpecId);

  const decodeMeta = useMemo(() => {
    if (!header || !tree) return null;
    const orderedIds = tree.fullNodeOrder;
    if (!orderedIds) return null;

    const localNodes = [
      ...tree.classNodes,
      ...tree.specNodes,
      ...tree.heroNodes,
      ...(tree.subTreeNodes ?? []),
    ];
    const localMap = new Map(localNodes.map((n) => [n.id, n.maxRanks ?? 1]));
    const maxRanks = new Map(
      orderedIds.map((id) => [id, tree.fullNodeMaxRanks?.[id] ?? localMap.get(id) ?? 1])
    );

    return { orderedIds, maxRanks };
  }, [header, tree]);

  // Decode selections from the (stable) talent string.
  // fullNodeOrder covers ALL nodes across all specs of the class.
  // fullNodeMaxRanks (from the backend) provides maxRanks for every node
  // including nodes from other specs. Without it, bit positions misalign
  // because the decoder can't determine the correct bit width for each node.
  const decodedFromString = useMemo(() => {
    if (!header || !tree || !decodeMeta) return null;
    const decoded = decodeNodes(
      header.bits,
      header.offset,
      decodeMeta.orderedIds,
      decodeMeta.maxRanks
    );

    // Auto-grant freeNode talents that the game grants implicitly.
    // Some export strings omit free entry nodes — grant ALL of them
    // (including both hero subtree entries, matching Raidbots behavior).
    for (const node of [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]) {
      if (node.freeNode && !decoded.has(node.id)) {
        decoded.set(node.id, { ranks: node.maxRanks, choiceIndex: -1 });
      }
    }

    return decoded;
  }, [header, tree, decodeMeta]);

  const purchasedFromString = useMemo(() => {
    if (!header || !decodeMeta || editable) return null;
    return decodeNodeSelections(
      header.bits,
      header.offset,
      decodeMeta.orderedIds,
      decodeMeta.maxRanks
    );
  }, [header, decodeMeta, editable]);

  // Editable state — initialized from decoded string once
  const [editSelections, setEditSelections] = useState<Map<number, NodeSelection>>(new Map());
  const [openChoiceNodeId, setOpenChoiceNodeId] = useState<number | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    if (editable && decodedFromString && !didInit.current) {
      setEditSelections(decodedFromString);
      didInit.current = true;
    }
  }, [editable, decodedFromString]);

  const selections = editable ? editSelections : decodedFromString;

  // Node map for rules engine (includes subTreeNodes for encoding)
  const nodeMap = useMemo(() => {
    if (!tree) return new Map<number, TalentNode>();
    const allNodes: TalentNode[] = [
      ...tree.classNodes,
      ...tree.specNodes,
      ...tree.heroNodes,
      ...((tree.subTreeNodes ?? []) as unknown as TalentNode[]),
    ];
    return new Map(allNodes.map((n) => [n.id, n]));
  }, [tree]);

  // Track a pending emit — encode and notify parent after render, not during
  const pendingEmit = useRef<Map<number, NodeSelection> | null>(null);
  useEffect(() => {
    if (!pendingEmit.current || !tree || !resolvedSpecId || !onTalentStringChange) return;
    const encoded = encodeTalentString(pendingEmit.current, tree, resolvedSpecId, header?.version);
    pendingEmit.current = null;
    onTalentStringChange(encoded);
  });

  const handleNodeClick = useCallback(
    (nodeId: number) => {
      if (!editable || !tree) return;
      setOpenChoiceNodeId(null);
      setEditSelections((prev) => {
        const next = toggleNode(nodeId, prev, tree, nodeMap);
        if (next !== prev) pendingEmit.current = next;
        return next;
      });
    },
    [editable, tree, nodeMap]
  );

  const handleNodeRightClick = useCallback(
    (nodeId: number) => {
      if (!editable || !tree) return;
      setOpenChoiceNodeId(null);
      setEditSelections((prev) => {
        const next = decrementNode(nodeId, prev, tree, nodeMap);
        if (next !== prev) pendingEmit.current = next;
        return next;
      });
    },
    [editable, tree, nodeMap]
  );

  const handleChoiceCycle = useCallback(
    (nodeId: number) => {
      if (!editable) return;
      setEditSelections((prev) => {
        const next = cycleChoice(nodeId, prev, nodeMap);
        if (next !== prev) pendingEmit.current = next;
        return next;
      });
    },
    [editable, nodeMap]
  );

  const handleChoiceSelect = useCallback(
    (nodeId: number, choiceIndex: number) => {
      if (!editable || !tree) return;
      const node = nodeMap.get(nodeId);
      if (!node || node.type !== 'choice' || choiceIndex < 0 || choiceIndex >= node.entries.length) {
        return;
      }
      setEditSelections((prev) => {
        const current = prev.get(nodeId);
        if (!current && !canSelectNode(nodeId, prev, tree, nodeMap)) return prev;
        const next = new Map(prev);
        next.set(nodeId, {
          ranks: current?.ranks ?? (node.freeNode ? node.maxRanks : 1),
          choiceIndex,
        });
        pendingEmit.current = next;
        return next;
      });
      setOpenChoiceNodeId(null);
    },
    [editable, tree, nodeMap]
  );

  const handleChoiceOpen = useCallback(
    (nodeId: number) => {
      if (!editable) return;
      setOpenChoiceNodeId((current) => (current === nodeId ? null : nodeId));
    },
    [editable]
  );

  useWowheadTooltips([selections]);

  if (!tree || !selections) {
    if (!talentString && !specIdProp) return null;
    if (mini) return null;
    return (
      <div className="card flex items-center justify-center p-5">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
      </div>
    );
  }

  const selectedSubTreeId = getActiveSubTreeId(selections, tree);
  const heroSubTreeControllers = useMemo(
    () => (tree.subTreeNodes ?? []).filter((node) => node.entries.length > 1),
    [tree.subTreeNodes]
  );
  const heroSubTreeOptions = useMemo(() => {
    const out: { nodeId: number; entryIndex: number; label: string; traitSubTreeId?: number }[] = [];
    for (const controller of heroSubTreeControllers) {
      controller.entries.forEach((entry, entryIndex) => {
        out.push({
          nodeId: controller.id,
          entryIndex,
          label: entry.name || `Hero Tree ${entryIndex + 1}`,
          traitSubTreeId: entry.traitSubTreeId,
        });
      });
    }
    return out;
  }, [heroSubTreeControllers]);
  const selectedHeroSubTreeKey = useMemo(() => {
    for (const option of heroSubTreeOptions) {
      const sel = selections.get(option.nodeId);
      if (sel && sel.choiceIndex === option.entryIndex) {
        return `${option.nodeId}:${option.entryIndex}`;
      }
    }
    return '';
  }, [heroSubTreeOptions, selections]);

  const handleHeroTreeChange = useCallback(
    (value: string) => {
      if (!editable || !tree) return;
      const [nodeIdRaw, entryIndexRaw] = value.split(':');
      const nodeId = Number(nodeIdRaw);
      const entryIndex = Number(entryIndexRaw);
      if (!Number.isFinite(nodeId) || !Number.isFinite(entryIndex)) return;
      const controller = heroSubTreeControllers.find((node) => node.id === nodeId);
      if (!controller || entryIndex < 0 || entryIndex >= controller.entries.length) return;
      const targetTraitSubTreeId = controller.entries[entryIndex]?.traitSubTreeId;

      setEditSelections((prev) => {
        const next = new Map(prev);
        next.set(controller.id, {
          ranks: Math.max(1, controller.maxRanks || 1),
          choiceIndex: entryIndex,
        });
        for (const heroNode of tree.heroNodes) {
          if (!heroNode.subTreeId || heroNode.subTreeId === targetTraitSubTreeId) continue;
          next.delete(heroNode.id);
        }
        pendingEmit.current = next;
        return next;
      });
    },
    [editable, heroSubTreeControllers, tree]
  );

  const activeHeroNodes = selectedSubTreeId
    ? tree.heroNodes.filter((n) => n.subTreeId === selectedSubTreeId)
    : [];
  const sharedHeroNodes = tree.heroNodes.filter((n) => !n.subTreeId);
  const visibleHeroNodes = [...activeHeroNodes, ...sharedHeroNodes];

  const classNodesForRender = filterRenderableNodes(tree.classNodes, selections);
  const specNodesForRender = filterRenderableNodes(tree.specNodes, selections);
  const heroNodesForRender = filterRenderableNodes(visibleHeroNodes, selections);

  const selectedSubTree = tree.subTreeNodes
    ?.flatMap((st) => st.entries)
    .find((e) => e.traitSubTreeId === selectedSubTreeId);

  const classNodeIds = new Set(tree.classNodes.map((n) => n.id));
  const specNodeIds = new Set(tree.specNodes.map((n) => n.id));
  const heroNodeIds = new Set(tree.heroNodes.map((n) => n.id));

  let purchasedSpent: { classPoints: number; specPoints: number; heroPoints: number } | null = null;
  if (purchasedFromString) {
    let classPoints = 0;
    let specPoints = 0;
    let heroPoints = 0;

    for (const [nodeId, state] of purchasedFromString) {
      if (!state.purchased) continue;
      if (classNodeIds.has(nodeId)) classPoints += state.ranks;
      else if (specNodeIds.has(nodeId)) specPoints += state.ranks;
      else if (heroNodeIds.has(nodeId)) heroPoints += state.ranks;
    }

    purchasedSpent = { classPoints, specPoints, heroPoints };
  }

  const classSpent = purchasedSpent?.classPoints ?? getPointsSpent(selections, tree.classNodes);
  const specSpent = purchasedSpent?.specPoints ?? getPointsSpent(selections, tree.specNodes);
  const heroSpent = purchasedSpent?.heroPoints ?? getPointsSpent(selections, tree.heroNodes);

  const allNodesArr = [...classNodesForRender, ...specNodesForRender, ...heroNodesForRender];

  const groups = [classNodesForRender, specNodesForRender, heroNodesForRender].filter(
    (g) => g.length > 0
  );
  let sharedViewportWidth = 1;
  let sharedViewportHeight = 1;
  for (const group of groups) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const node of group) {
      minX = Math.min(minX, node.posX);
      maxX = Math.max(maxX, node.posX);
      minY = Math.min(minY, node.posY);
      maxY = Math.max(maxY, node.posY);
    }

    const groupWidth = maxX - minX + NODE_SIZE + PADDING * 2;
    const groupHeight = maxY - minY + NODE_SIZE + PADDING * 2;
    sharedViewportWidth = Math.max(sharedViewportWidth, groupWidth);
    sharedViewportHeight = Math.max(sharedViewportHeight, groupHeight);
  }
  const sharedViewport = { width: sharedViewportWidth, height: sharedViewportHeight };

  if (mini) {
    return (
      <div className="flex h-full w-full items-stretch gap-0.5">
        <div className="min-w-0 flex-[2]">
          <MiniTreeSvg nodes={classNodesForRender} selections={selections} allNodes={allNodesArr} />
        </div>
        {heroNodesForRender.length > 0 && (
          <div className="h-[45%] min-w-0 flex-1 self-center">
            <MiniTreeSvg
              nodes={heroNodesForRender}
              selections={selections}
              allNodes={allNodesArr}
            />
          </div>
        )}
        <div className="min-w-0 flex-[2]">
          <MiniTreeSvg nodes={specNodesForRender} selections={selections} allNodes={allNodesArr} />
        </div>
      </div>
    );
  }

  return (
    <div className={bare ? 'space-y-3' : 'card space-y-3 p-4'}>
      {!bare && <p className="text-xs font-medium uppercase tracking-widest text-muted">Talents</p>}
      {editable && heroSubTreeOptions.length > 1 && (
        <div className="flex items-center justify-end">
          <select
            value={selectedHeroSubTreeKey || `${heroSubTreeOptions[0]?.nodeId}:${heroSubTreeOptions[0]?.entryIndex}`}
            onChange={(e) => handleHeroTreeChange(e.target.value)}
            className="input-field h-8 min-w-[220px] px-2 py-1 text-[11px] font-bold text-zinc-100"
            style={{ colorScheme: 'dark' }}
          >
            {heroSubTreeOptions.map((option) => (
              <option
                key={`${option.nodeId}:${option.entryIndex}`}
                value={`${option.nodeId}:${option.entryIndex}`}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
        <TreeSection
          label={tree.className}
          nodes={classNodesForRender}
          selections={selections}
          allNodes={allNodesArr}
          editable={editable}
          tree={tree}
          nodeMap={nodeMap}
          onNodeClick={handleNodeClick}
          onNodeRightClick={handleNodeRightClick}
          onChoiceCycle={handleChoiceCycle}
          onChoiceSelect={handleChoiceSelect}
          onChoiceOpen={handleChoiceOpen}
          openChoiceNodeId={openChoiceNodeId}
          pointsDisplay={`${classSpent}/${CLASS_POINTS}`}
          viewport={sharedViewport}
        />
        {heroNodesForRender.length > 0 && (
          <>
            <div className="hidden h-auto w-px bg-border lg:block" />
            <TreeSection
              label={selectedSubTree?.name ?? 'Hero'}
              nodes={heroNodesForRender}
              selections={selections}
              allNodes={allNodesArr}
              editable={editable}
              tree={tree}
              nodeMap={nodeMap}
              onNodeClick={handleNodeClick}
              onNodeRightClick={handleNodeRightClick}
              onChoiceCycle={handleChoiceCycle}
              onChoiceSelect={handleChoiceSelect}
              onChoiceOpen={handleChoiceOpen}
              openChoiceNodeId={openChoiceNodeId}
              pointsDisplay={`${heroSpent}`}
              viewport={sharedViewport}
            />
          </>
        )}
        <div className="hidden h-auto w-px bg-border lg:block" />
        <TreeSection
          label={tree.specName}
          nodes={specNodesForRender}
          selections={selections}
          allNodes={allNodesArr}
          editable={editable}
          tree={tree}
          nodeMap={nodeMap}
          onNodeClick={handleNodeClick}
          onNodeRightClick={handleNodeRightClick}
          onChoiceCycle={handleChoiceCycle}
          onChoiceSelect={handleChoiceSelect}
          onChoiceOpen={handleChoiceOpen}
          openChoiceNodeId={openChoiceNodeId}
          pointsDisplay={`${specSpent}/${SPEC_POINTS}`}
          viewport={sharedViewport}
        />
      </div>
    </div>
  );
}

interface TreeSectionProps {
  label: string;
  nodes: TalentNode[];
  selections: Map<number, NodeSelection>;
  allNodes: TalentNode[];
  compact?: boolean;
  editable?: boolean;
  tree?: TalentTreeData;
  nodeMap?: Map<number, TalentNode>;
  onNodeClick?: (nodeId: number) => void;
  onNodeRightClick?: (nodeId: number) => void;
  onChoiceCycle?: (nodeId: number) => void;
  onChoiceSelect?: (nodeId: number, choiceIndex: number) => void;
  onChoiceOpen?: (nodeId: number) => void;
  openChoiceNodeId?: number | null;
  pointsDisplay?: string;
  viewport?: { width: number; height: number };
}

function TreeSection({
  label,
  nodes,
  selections,
  allNodes,
  compact,
  editable,
  tree,
  nodeMap,
  onNodeClick,
  onNodeRightClick,
  onChoiceCycle,
  onChoiceSelect,
  onChoiceOpen,
  openChoiceNodeId,
  pointsDisplay,
  viewport,
}: TreeSectionProps) {
  const nodeById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);

  const bounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.posX);
      maxX = Math.max(maxX, n.posX);
      minY = Math.min(minY, n.posY);
      maxY = Math.max(maxY, n.posY);
    }
    return { minX, maxX, minY, maxY };
  }, [nodes]);

  const openChoiceNode = useMemo(
    () => nodes.find((node) => node.id === openChoiceNodeId),
    [nodes, openChoiceNodeId]
  );
  const choicePickerWidth = openChoiceNode
    ? openChoiceNode.entries.length * 420 + Math.max(0, openChoiceNode.entries.length - 1) * 44
    : 0;
  const choiceBounds = openChoiceNode
    ? {
        minX: openChoiceNode.posX - choicePickerWidth / 2,
        maxX: openChoiceNode.posX + choicePickerWidth / 2,
        minY: openChoiceNode.posY - NODE_SIZE / 2 - 190,
        maxY: openChoiceNode.posY - NODE_SIZE / 2 - 40,
      }
    : null;

  const effectiveBounds = choiceBounds
    ? {
        minX: Math.min(bounds.minX, choiceBounds.minX),
        maxX: Math.max(bounds.maxX, choiceBounds.maxX),
        minY: Math.min(bounds.minY, choiceBounds.minY),
        maxY: Math.max(bounds.maxY, choiceBounds.maxY),
      }
    : bounds;
  const centerX = (effectiveBounds.minX + effectiveBounds.maxX) / 2;
  const centerY = (effectiveBounds.minY + effectiveBounds.maxY) / 2;
  const neededVbW = effectiveBounds.maxX - effectiveBounds.minX + NODE_SIZE + PADDING * 2;
  const neededVbH = effectiveBounds.maxY - effectiveBounds.minY + NODE_SIZE + PADDING * 2;
  const vbW = viewport ? Math.max(viewport.width, neededVbW) : neededVbW;
  const vbH = viewport ? Math.max(viewport.height, neededVbH) : neededVbH;
  const vbX = centerX - vbW / 2;
  const vbY = centerY - vbH / 2;

  const sectionNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  return (
    <div className={compact ? 'w-[260px] shrink-0' : 'min-w-0 flex-1'}>
      <div className="mb-1 flex items-center justify-center gap-2">
        <p className="text-center text-[12px] font-medium uppercase tracking-wider text-muted">
          {label}
        </p>
        {pointsDisplay && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-muted">
            {pointsDisplay}
          </span>
        )}
      </div>
      <svg
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className={`w-full ${compact ? 'max-h-[460px]' : 'max-h-[620px]'}`}
        preserveAspectRatio="xMidYMid meet"
        onContextMenu={editable ? (e) => e.preventDefault() : undefined}
      >
        {/* Connections */}
        {nodes.map((node) =>
          node.next
            .filter((targetId) => sectionNodeIds.has(targetId))
            .map((targetId) => {
              const target = nodeById.get(targetId);
              if (!target) return null;
              const sourceSelected = selections.has(node.id);
              const targetSelected = selections.has(targetId);
              const active = sourceSelected && targetSelected;
              return (
                <line
                  key={`${node.id}-${targetId}`}
                  x1={node.posX}
                  y1={node.posY}
                  x2={target.posX}
                  y2={target.posY}
                  stroke={active ? GOLD : DIM}
                  strokeWidth={active ? 16 : 10}
                  strokeLinecap="round"
                />
              );
            })
        )}
        {/* Nodes */}
        {nodes.map((node) => {
          const sel = selections.get(node.id);
          const selectable =
            editable && tree && nodeMap ? canSelectNode(node.id, selections, tree, nodeMap) : false;
          const deselectable =
            editable && tree && nodeMap
              ? canDeselectNode(node.id, selections, tree, nodeMap)
              : false;

          return (
            <TalentNodeSvg
              key={node.id}
              node={node}
              selection={sel}
              editable={editable}
              selectable={selectable}
              deselectable={deselectable}
              onClick={onNodeClick}
              onRightClick={onNodeRightClick}
              onChoiceCycle={onChoiceCycle}
              onChoiceSelect={onChoiceSelect}
              onChoiceOpen={onChoiceOpen}
              choicePickerOpen={openChoiceNodeId === node.id}
            />
          );
        })}
      </svg>
    </div>
  );
}

function TalentNodeSvg({
  node,
  selection,
  editable,
  selectable,
  deselectable,
  onClick,
  onRightClick,
  onChoiceCycle,
  onChoiceSelect,
  onChoiceOpen,
  choicePickerOpen,
}: {
  node: TalentNode;
  selection?: NodeSelection;
  editable?: boolean;
  selectable?: boolean;
  deselectable?: boolean;
  onClick?: (nodeId: number) => void;
  onRightClick?: (nodeId: number) => void;
  onChoiceCycle?: (nodeId: number) => void;
  onChoiceSelect?: (nodeId: number, choiceIndex: number) => void;
  onChoiceOpen?: (nodeId: number) => void;
  choicePickerOpen?: boolean;
}) {
  const isSelected = !!selection;
  const isChoice = node.type === 'choice' && node.entries.length > 1;
  const isInteractable = editable && (selectable || isSelected);

  // For choice nodes, pick the selected entry; otherwise use first
  let entry = node.entries[0];
  if (
    isChoice &&
    selection &&
    selection.choiceIndex >= 0 &&
    selection.choiceIndex < node.entries.length
  ) {
    entry = node.entries[selection.choiceIndex];
  }

  const icon = entry?.icon;
  const spellId = entry?.spellId;
  const isActive = entry?.type === 'active';
  const half = NODE_SIZE / 2;
  const iconHalf = ICON_SIZE / 2;

  const borderColor = isSelected
    ? GOLD
    : editable && selectable
      ? 'rgba(34,197,94,0.95)'
      : 'rgba(255,255,255,0.1)';
  const borderWidth = isSelected ? 12 : 6;

  const opacity = isSelected ? 1 : editable ? (selectable ? 0.85 : LOCKED_ICON) : DIM_ICON;

  const handleClick = () => {
    if (!editable) return;
    if (isChoice && (selectable || isSelected)) {
      onChoiceOpen?.(node.id);
    } else {
      onClick?.(node.id);
    }
  };

  const handleRightClick = (e: React.MouseEvent) => {
    if (!editable) return;
    e.preventDefault();
    onRightClick?.(node.id);
  };

  return (
    <g
      opacity={opacity}
      className={isInteractable ? 'cursor-pointer' : ''}
      data-wowhead={spellId ? `spell=${spellId}` : undefined}
      onClick={editable ? handleClick : undefined}
      onContextMenu={editable ? handleRightClick : undefined}
    >
      {isChoice ? (
        <OctagonShape
          cx={node.posX}
          cy={node.posY}
          size={half}
          fill="#0a0a0a"
          stroke={borderColor}
          strokeWidth={borderWidth}
        />
      ) : (
        <rect
          x={node.posX - half}
          y={node.posY - half}
          width={NODE_SIZE}
          height={NODE_SIZE}
          rx={isActive ? 8 : half}
          fill="#0a0a0a"
          stroke={borderColor}
          strokeWidth={borderWidth}
        />
      )}
      {editable && selectable && !isSelected && (
        isChoice ? (
          <OctagonShape
            cx={node.posX}
            cy={node.posY}
            size={half + 24}
            fill="none"
            stroke="rgba(34,197,94,0.55)"
            strokeWidth={8}
          />
        ) : (
          <rect
            x={node.posX - half - 24}
            y={node.posY - half - 24}
            width={NODE_SIZE + 48}
            height={NODE_SIZE + 48}
            rx={isActive ? 14 : half + 24}
            fill="none"
            stroke="rgba(34,197,94,0.55)"
            strokeWidth={8}
          />
        )
      )}
      {/* Clip icon to shape */}
      <clipPath id={`clip-${node.id}`}>
        {isChoice ? (
          <OctagonShape cx={node.posX} cy={node.posY} size={iconHalf} />
        ) : (
          <rect
            x={node.posX - iconHalf}
            y={node.posY - iconHalf}
            width={ICON_SIZE}
            height={ICON_SIZE}
            rx={isActive ? 4 : iconHalf}
          />
        )}
      </clipPath>
      {icon && (
        <image
          href={`https://render.worldofwarcraft.com/icons/56/${icon}.jpg`}
          x={node.posX - iconHalf}
          y={node.posY - iconHalf}
          width={ICON_SIZE}
          height={ICON_SIZE}
          clipPath={`url(#clip-${node.id})`}
        />
      )}
      {/* Rank badge for multi-rank nodes */}
      {node.maxRanks > 1 && isSelected && selection && (
        <g>
          <rect
            x={node.posX + half - 122}
            y={node.posY + half - 96}
            width={180}
            height={108}
            rx={18}
            fill="#0a0a0a"
            stroke={borderColor}
            strokeWidth={6}
          />
          <text
            x={node.posX + half - 32}
            y={node.posY + half - 24}
            textAnchor="middle"
            fill={selection.ranks >= node.maxRanks ? GOLD : '#999'}
            fontSize={72}
            fontFamily="system-ui, sans-serif"
            fontWeight="bold"
          >
            {selection.ranks}/{node.maxRanks}
          </text>
        </g>
      )}
      {editable && isChoice && choicePickerOpen && (
        <g>
          {node.entries.map((choice, index) => {
            const cardW = 420;
            const cardH = 150;
            const gap = 44;
            const totalW = node.entries.length * cardW + (node.entries.length - 1) * gap;
            const x = node.posX - totalW / 2 + index * (cardW + gap);
            const y = node.posY - half - 190;
            const activeChoice = selection?.choiceIndex === index;
            return (
              <g
                key={`${node.id}-${choice.id}-${index}`}
                className="cursor-pointer"
                data-wowhead={choice.spellId ? `spell=${choice.spellId}` : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChoiceSelect?.(node.id, index);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <rect
                  x={x}
                  y={y}
                  width={cardW}
                  height={cardH}
                  rx={24}
                  fill={activeChoice ? 'rgba(200,153,42,0.22)' : 'rgba(13,15,21,0.98)'}
                  stroke={activeChoice ? GOLD : 'rgba(255,255,255,0.28)'}
                  strokeWidth={activeChoice ? 8 : 5}
                />
                <rect
                  x={x + 18}
                  y={y + 18}
                  width={112}
                  height={112}
                  rx={18}
                  fill="#07080b"
                  stroke={activeChoice ? GOLD : 'rgba(255,255,255,0.22)'}
                  strokeWidth={5}
                />
                {choice.icon && (
                  <image
                    href={`https://render.worldofwarcraft.com/icons/56/${choice.icon}.jpg`}
                    x={x + 24}
                    y={y + 24}
                    width={100}
                    height={100}
                  />
                )}
                <text
                  x={x + 150}
                  y={y + 64}
                  fill="#f4f4f5"
                  fontSize={38}
                  fontFamily="system-ui, sans-serif"
                  fontWeight="800"
                >
                  {(choice.name || `Option ${index + 1}`).slice(0, 18)}
                </text>
                <text
                  x={x + 150}
                  y={y + 108}
                  fill={activeChoice ? GOLD : 'rgba(212,212,216,0.72)'}
                  fontSize={28}
                  fontFamily="system-ui, sans-serif"
                  fontWeight="700"
                >
                  {activeChoice ? 'Selected' : 'Choose'}
                </text>
              </g>
            );
          })}
        </g>
      )}
      {/* Hover-only Wowhead tooltip layer (no redirect link). */}
      {spellId && (
        <foreignObject
          x={node.posX - half}
          y={node.posY - half}
          width={NODE_SIZE}
          height={NODE_SIZE}
        >
          <a
            href={`https://www.wowhead.com/spell=${spellId}`}
            data-wowhead={`spell=${spellId}`}
            style={{ display: 'block', width: '100%', height: '100%' }}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDownCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerUpCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDownCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseUpCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (editable) handleClick();
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (editable) handleClick();
            }}
            onAuxClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (editable) onRightClick?.(node.id);
            }}
          />
        </foreignObject>
      )}
    </g>
  );
}

function MiniTreeSvg({
  nodes,
  selections,
  allNodes,
}: {
  nodes: TalentNode[];
  selections: Map<number, NodeSelection>;
  allNodes: TalentNode[];
}) {
  const nodeById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  const sectionIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  if (nodes.length === 0) return null;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.posX);
    maxX = Math.max(maxX, n.posX);
    minY = Math.min(minY, n.posY);
    maxY = Math.max(maxY, n.posY);
  }
  const pad = 300;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {nodes.map((node) =>
        node.next
          .filter((tid) => sectionIds.has(tid))
          .map((tid) => {
            const target = nodeById.get(tid);
            if (!target) return null;
            const active = selections.has(node.id) && selections.has(tid);
            return (
              <line
                key={`${node.id}-${tid}`}
                x1={node.posX}
                y1={node.posY}
                x2={target.posX}
                y2={target.posY}
                stroke={active ? GOLD : 'rgba(255,255,255,0.08)'}
                strokeWidth={active ? 40 : 24}
                strokeLinecap="round"
              />
            );
          })
      )}
      {nodes.map((node) => {
        const selected = selections.has(node.id);
        const sel = selections.get(node.id);
        const isChoice = node.type === 'choice' && node.entries.length > 1;
        let entry = node.entries[0];
        if (isChoice && sel && sel.choiceIndex >= 0 && sel.choiceIndex < node.entries.length) {
          entry = node.entries[sel.choiceIndex];
        }
        const icon = entry?.icon;
        const r = 140;
        return (
          <g key={node.id} opacity={selected ? 1 : 0.25}>
            <clipPath id={`mini-clip-${node.id}`}>
              <circle cx={node.posX} cy={node.posY} r={r} />
            </clipPath>
            {icon ? (
              <image
                href={`https://render.worldofwarcraft.com/icons/56/${icon}.jpg`}
                x={node.posX - r}
                y={node.posY - r}
                width={r * 2}
                height={r * 2}
                clipPath={`url(#mini-clip-${node.id})`}
              />
            ) : (
              <circle cx={node.posX} cy={node.posY} r={r} fill="rgba(255,255,255,0.08)" />
            )}
            {selected && (
              <circle
                cx={node.posX}
                cy={node.posY}
                r={r}
                fill="none"
                stroke={GOLD}
                strokeWidth={20}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function OctagonShape({
  cx,
  cy,
  size,
  fill,
  stroke,
  strokeWidth,
}: {
  cx: number;
  cy: number;
  size: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  const points = Array.from({ length: 8 }, (_, i) => {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
    return `${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`;
  }).join(' ');

  return (
    <polygon
      points={points}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  );
}
